/**
 * Persist the resolved speaker table and node addressees of one mod.
 */
import type { Tx } from '../../../db';
import { logImport } from '../../../logging/loggers';
import { DIALOG_RESPONSE_PATH } from '../../data/queries/dialogs';
import { resolveNodeAddressees, type ScenePhaseRow, type SpeakerNodeRow } from './addressees';
import type { PluginSpeakerIndex } from './pluginSpeakerIndex';
import { buildDialogSpeakerRows, type DialogSpeakerRow } from './speakerRows';
import { buildActorSpeakerRowsFromIndex } from './actorSpeakerRows';

type NodeRow = SpeakerNodeRow & {
  speaker_name: string | null;
  info_formid_hex: string;
};

export type DialogSpeakerResolution = {
  speakers: number;
  nodes: number;
  withGender: number;
};

const loadNodes = async (db: Tx, modId: number): Promise<NodeRow[]> => {
  const { rows } = await db.query<NodeRow>(
    `SELECT dn.id, dn.topic_id, dn.speaker_key, dn.speaker_name, dn.info_formid_hex
       FROM dialog_nodes dn
       JOIN dialog_topics dt ON dt.id = dn.topic_id
      WHERE dt.mod_id = $1`,
    [modId],
  );
  return rows;
};

const loadScenePhases = async (db: Tx, modId: number): Promise<ScenePhaseRow[]> => {
  const { rows } = await db.query<ScenePhaseRow>(
    `SELECT dsp.scene_id, dsp.phase_order, dsp.alias_id, dsp.topic_id
       FROM dialog_scene_phases dsp
       JOIN dialog_scenes ds ON ds.id = dsp.scene_id
      WHERE ds.mod_id = $1`,
    [modId],
  );
  return rows;
};

const loadLineCounts = async (db: Tx, modId: number): Promise<Map<string, number>> => {
  const { rows } = await db.query<{ speaker_key: string; cnt: number }>(
    `SELECT dn.speaker_key, COUNT(DISTINCT r.id)::int AS cnt
       FROM dialog_nodes dn
       JOIN dialog_topics dt ON dt.id = dn.topic_id
       JOIN records r
         ON r.mod_id = dt.mod_id
        AND r.signature = 'INFO'
        AND r.formid_hex = dn.info_formid_hex
        AND r.path_simplified = $2
      WHERE dt.mod_id = $1 AND dn.speaker_key IS NOT NULL
      GROUP BY dn.speaker_key`,
    [modId, DIALOG_RESPONSE_PATH],
  );
  return new Map(rows.map((row) => [row.speaker_key, row.cnt]));
};

const upsertSpeakers = async (
  db: Tx,
  modId: number,
  speakers: DialogSpeakerRow[],
  lineCounts: Map<string, number>,
): Promise<void> => {
  if (speakers.length === 0) return;

  await db.query(
    `INSERT INTO dialog_speakers(
       mod_id, speaker_key, display_name, voice_type, is_player,
       detected_gender, detected_source, line_count
     )
     SELECT $1, * FROM UNNEST(
       $2::text[], $3::text[], $4::text[], $5::boolean[], $6::text[], $7::text[], $8::int[]
     )
     ON CONFLICT(mod_id, speaker_key) DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, dialog_speakers.display_name),
       voice_type = COALESCE(EXCLUDED.voice_type, dialog_speakers.voice_type),
       is_player = EXCLUDED.is_player,
       detected_gender = EXCLUDED.detected_gender,
       detected_source = EXCLUDED.detected_source,
       line_count = EXCLUDED.line_count,
       updated_at = NOW()`,
    [
      modId,
      speakers.map((s) => s.speakerKey),
      speakers.map((s) => s.displayName),
      speakers.map((s) => s.voiceType),
      speakers.map((s) => s.isPlayer),
      speakers.map((s) => s.detectedGender),
      speakers.map((s) => s.detectedSource),
      speakers.map((s) => lineCounts.get(s.speakerKey) ?? 0),
    ],
  );

  await db.query(
    `DELETE FROM dialog_speakers WHERE mod_id = $1 AND speaker_key <> ALL($2::text[])`,
    [modId, speakers.map((s) => s.speakerKey)],
  );
};

const updateAddressees = async (
  db: Tx,
  addressees: ReturnType<typeof resolveNodeAddressees>['addressees'],
): Promise<void> => {
  if (addressees.length === 0) return;
  await db.query(
    `UPDATE dialog_nodes dn
        SET addressee_kind = u.kind,
            addressee_speaker_key = u.speaker_key,
            updated_at = NOW()
       FROM UNNEST($1::int[], $2::text[], $3::text[]) AS u(id, kind, speaker_key)
      WHERE dn.id = u.id`,
    [
      addressees.map((a) => a.nodeId),
      addressees.map((a) => a.kind),
      addressees.map((a) => a.speakerKey),
    ],
  );
};

/**
 * Resolve gender for every dialog speaker of a mod and record who each node
 * addresses.
 *
 * Runs after scenes are imported because scene aliases are what identify the
 * player and the counterpart of a conversation. Manual overrides in
 * `dialog_speakers.gender_override` are left alone unless a backfill pass
 * explicitly clears them first.
 */
export const resolveModDialogSpeakers = async (
  db: Tx,
  modId: number,
  index: PluginSpeakerIndex,
): Promise<DialogSpeakerResolution> => {
  const nodes = await loadNodes(db, modId);
  const phases = nodes.length > 0 ? await loadScenePhases(db, modId) : [];
  const { addressees, playerSpeakerKeys } =
    nodes.length > 0
      ? resolveNodeAddressees(nodes, phases)
      : { addressees: [], playerSpeakerKeys: new Set<string>() };

  const dialogSpeakers =
    nodes.length > 0 ? buildDialogSpeakerRows({ nodes, index, playerSpeakerKeys }) : [];
  const dialogKeys = new Set(dialogSpeakers.map((s) => s.speakerKey));
  const actorSpeakers = buildActorSpeakerRowsFromIndex(index, dialogKeys);
  const speakers: DialogSpeakerRow[] = [...dialogSpeakers, ...actorSpeakers];
  const lineCounts = nodes.length > 0 ? await loadLineCounts(db, modId) : new Map<string, number>();

  if (addressees.length > 0) await updateAddressees(db, addressees);
  await upsertSpeakers(db, modId, speakers, lineCounts);

  const withGender = speakers.filter((s) => s.detectedGender !== 'unknown').length;
  logImport.info(
    `Dialog speakers for mod ${modId}: ${speakers.length} speaker(s), ${withGender} with a known gender`,
  );

  return { speakers: speakers.length, nodes: nodes.length, withGender };
};

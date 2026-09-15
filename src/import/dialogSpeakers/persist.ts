/**
 * Persist the resolved speaker table and node addressees of one mod.
 */
import type { Tx } from '../../db';
import { collectPronounEvidence } from '../../dialog';
import { logImport } from '../../logging/loggers';
import { DIALOG_RESPONSE_PATH } from '../../web/data/queries/dialogs';
import {
  resolveNodeAddressees,
  type RecoveredNodeSpeaker,
  type ScenePhaseRow,
  type SpeakerNodeRow,
} from './addressees';
import type { PluginSpeakerIndex } from './pluginSpeakerIndex';
import {
  buildDialogSpeakerRows,
  markPlayerSpeakers,
  playerKeysFromRows,
  type DialogSpeakerRow,
} from './speakerRows';
import { buildActorSpeakerRowsFromIndex } from './actorSpeakerRows';

/**
 * Scanning the mod's text per name is linear in the number of names, so a mod
 * with hundreds of anonymous speakers is capped rather than allowed to crawl.
 */
const PRONOUN_EVIDENCE_NAME_LIMIT = 300;

/** Locale the plugin's own strings are stored under when nothing else is known. */
const DEFAULT_SOURCE_LANG = 'en';

type NodeRow = SpeakerNodeRow & {
  speaker_name: string | null;
  info_formid_hex: string;
};

export type DialogSpeakerResolution = {
  speakers: number;
  nodes: number;
  withGender: number;
  /** Speaker-less nodes a scene alias could name after the fact. */
  recoveredSpeakers: number;
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

/** Names still without a gender, worth spending a text scan on. */
const namesNeedingEvidence = (speakers: readonly DialogSpeakerRow[]): string[] =>
  [
    ...new Set(
      speakers
        .filter((s) => s.detectedGender === 'unknown' && !s.isPlayer && s.displayName)
        .map((s) => s.displayName!.trim())
        .filter((name) => name.length >= 3),
    ),
  ].slice(0, PRONOUN_EVIDENCE_NAME_LIMIT);

/**
 * Source-language lines of the mod that mention one of `names`.
 *
 * Scanning every string for every name would be the same work done many times;
 * Postgres filters first and hands back only the lines that could matter.
 */
const loadTextsMentioningNames = async (
  db: Tx,
  modId: number,
  names: string[],
  srcLang: string,
): Promise<Map<string, string[]>> => {
  const byName = new Map<string, string[]>(names.map((name) => [name, []]));
  if (names.length === 0) return byName;

  const { rows } = await db.query<{ name: string; text_raw: string }>(
    `SELECT n.name, s.text_raw
       FROM UNNEST($2::text[]) AS n(name)
       JOIN records r ON r.mod_id = $1
       JOIN strings s ON s.record_id = r.id AND s.lang = $3
      WHERE s.text_raw ILIKE '%' || n.name || '%'`,
    [modId, names, srcLang],
  );

  for (const row of rows) byName.get(row.name)?.push(row.text_raw);
  return byName;
};

/**
 * Fill in the gender of speakers the plugin never gendered, from the way the
 * rest of the mod refers to them.
 */
const applyPronounEvidence = async (
  db: Tx,
  modId: number,
  speakers: DialogSpeakerRow[],
  srcLang: string,
): Promise<DialogSpeakerRow[]> => {
  const names = namesNeedingEvidence(speakers);
  if (names.length === 0) return speakers;

  const textsByName = await loadTextsMentioningNames(db, modId, names, srcLang);

  return speakers.map((speaker) => {
    if (speaker.detectedGender !== 'unknown' || speaker.isPlayer || !speaker.displayName) {
      return speaker;
    }
    const texts = textsByName.get(speaker.displayName.trim());
    if (!texts || texts.length === 0) return speaker;

    const evidence = collectPronounEvidence(speaker.displayName, texts);
    if (evidence.gender === 'unknown') return speaker;

    logImport.debug(
      `Speaker "${speaker.displayName}" read as ${evidence.gender} from ${evidence.male}m/${evidence.female}f pronoun mentions`,
    );
    return { ...speaker, detectedGender: evidence.gender, detectedSource: 'pronoun_evidence' };
  });
};

const updateRecoveredSpeakers = async (
  db: Tx,
  recovered: RecoveredNodeSpeaker[],
): Promise<void> => {
  if (recovered.length === 0) return;
  await db.query(
    `UPDATE dialog_nodes dn
        SET speaker_key = u.speaker_key,
            updated_at = NOW()
       FROM UNNEST($1::int[], $2::text[]) AS u(id, speaker_key)
      WHERE dn.id = u.id AND dn.speaker_key IS NULL`,
    [recovered.map((r) => r.nodeId), recovered.map((r) => r.speakerKey)],
  );
};

/**
 * Resolve gender for every dialog speaker of a mod and record who each node
 * addresses.
 *
 * Runs after scenes are imported because scene aliases are what identify the
 * player, name the speakers the plugin left blank, and give the counterpart of
 * a conversation. Manual overrides in `dialog_speakers.gender_override` are
 * left alone unless a backfill pass explicitly clears them first.
 */
export const resolveModDialogSpeakers = async (
  db: Tx,
  modId: number,
  index: PluginSpeakerIndex,
  srcLang: string = DEFAULT_SOURCE_LANG,
): Promise<DialogSpeakerResolution> => {
  const nodes = await loadNodes(db, modId);
  if (nodes.length === 0) {
    const actorOnly = buildActorSpeakerRowsFromIndex(index, new Set());
    await upsertSpeakers(db, modId, actorOnly, new Map());
    return {
      speakers: actorOnly.length,
      nodes: 0,
      withGender: actorOnly.filter((s) => s.detectedGender !== 'unknown').length,
      recoveredSpeakers: 0,
    };
  }

  const phases = await loadScenePhases(db, modId);
  const fromPlugin = buildDialogSpeakerRows({ nodes, index });
  const { addressees, playerSpeakerKeys, recoveredSpeakers } = resolveNodeAddressees(
    nodes,
    phases,
    playerKeysFromRows(fromPlugin),
  );

  // A recovered node now speaks through a key the speaker table already holds,
  // so the rows themselves need no rebuild — only the nodes do.
  const dialogSpeakers = markPlayerSpeakers(fromPlugin, playerSpeakerKeys);
  const dialogKeys = new Set(dialogSpeakers.map((s) => s.speakerKey));
  const actorSpeakers = buildActorSpeakerRowsFromIndex(index, dialogKeys);
  const speakers = await applyPronounEvidence(
    db,
    modId,
    [...dialogSpeakers, ...actorSpeakers],
    srcLang,
  );

  await updateRecoveredSpeakers(db, recoveredSpeakers);
  if (addressees.length > 0) await updateAddressees(db, addressees);
  await upsertSpeakers(db, modId, speakers, await loadLineCounts(db, modId));

  const withGender = speakers.filter((s) => s.detectedGender !== 'unknown').length;
  logImport.info(
    `Dialog speakers for mod ${modId}: ${speakers.length} speaker(s), ${withGender} with a known gender` +
      (recoveredSpeakers.length > 0
        ? `, ${recoveredSpeakers.length} node(s) named from a scene alias`
        : ''),
  );

  return {
    speakers: speakers.length,
    nodes: nodes.length,
    withGender,
    recoveredSpeakers: recoveredSpeakers.length,
  };
};

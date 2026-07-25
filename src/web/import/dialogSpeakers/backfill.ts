/**
 * Rebuild speaker attribution for mods imported before gender tracking existed.
 *
 * Those imports stored the dialog graph but left `dialog_nodes.speaker_key`
 * empty and never wrote a `dialog_speakers` row, so every line looks like it
 * has an unknown speaker. Re-running the whole import would be wasteful: the
 * nodes are already there, and the only missing facts come from the plugin's
 * actor records and the voice folders next to it.
 */
import fs from 'node:fs';
import type { Tx } from '../../../db';
import { voiceFolderSpeakerKey } from '../../../dialog';
import { EspReader } from '../../../formats/esp';
import { loadNpcReferenceMap } from '../../../formats/subrecords';
import { logImport } from '../../../logging/loggers';
import { resolveModStoredPath } from '../../../modStorage/paths';
import type { GameType } from '../../../types';
import { resolveEnglishLocaleMaps } from '../modImport/csvHelpers';
import { discoverArchiveCandidatesForPlugin } from '../modImport/discovery';
import { buildVoiceFolderMap } from '../modImport/speakerMaps';
import { discoverLocaleSources } from '../modImportLocaleStream';
import { buildPluginSpeakerIndex } from './pluginSpeakerIndex';
import { buildSpeakerActorIndex, loadPluginPathByBasename } from './masterPlugins';
import { resolveModDialogSpeakers, type DialogSpeakerResolution } from './persist';

export type DialogSpeakerBackfillOptions = {
  /** Drop manual gender overrides before recomputing detected values. */
  resetOverrides?: boolean;
  /** Cached mod plugin paths, keyed by basename. */
  storedByBasename?: Map<string, string>;
};

export type DialogSpeakerBackfillTarget = {
  modId: number;
  modName: string;
  game: GameType;
  absPath: string | null;
  nodes: number;
  speakers: number;
};

export type DialogSpeakerBackfillResult = DialogSpeakerResolution & {
  modId: number;
  modName: string;
  pluginPath: string;
  /** Nodes that gained a speaker key during this run. */
  keyedNodes: number;
};

/**
 * Mods whose dialog graph could carry speaker gender.
 *
 * @param onlyMissing - Skip mods that already have a resolved speaker table.
 */
export const listDialogSpeakerBackfillTargets = async (
  db: Tx,
  onlyMissing = true,
): Promise<DialogSpeakerBackfillTarget[]> => {
  const { rows } = await db.query<{
    mod_id: number;
    mod_name: string;
    game: string;
    abs_path: string | null;
    nodes: number;
    speakers: number;
  }>(
    `SELECT m.id AS mod_id, m.name AS mod_name, m.game, m.abs_path,
            count(dn.id)::int AS nodes,
            (SELECT count(*)::int FROM dialog_speakers ds WHERE ds.mod_id = m.id) AS speakers
       FROM mods m
       JOIN dialog_topics dt ON dt.mod_id = m.id
       JOIN dialog_nodes dn ON dn.topic_id = dt.id
      GROUP BY m.id, m.name, m.game, m.abs_path
     HAVING NOT $1::boolean
         OR (SELECT count(*) FROM dialog_speakers ds WHERE ds.mod_id = m.id) = 0
      ORDER BY nodes DESC`,
    [onlyMissing],
  );

  return rows.map((row) => ({
    modId: row.mod_id,
    modName: row.mod_name,
    game: row.game as GameType,
    absPath: row.abs_path,
    nodes: row.nodes,
    speakers: row.speakers,
  }));
};

/** Speaker key of every node whose INFO record names its actor outright. */
const keyNodesFromActorFormId = async (db: Tx, modId: number): Promise<number> => {
  const { rowCount } = await db.query(
    `UPDATE dialog_nodes dn
        SET speaker_key = 'npc:' || upper(dn.speaker_formid_hex),
            updated_at = NOW()
       FROM dialog_topics dt
      WHERE dt.id = dn.topic_id
        AND dt.mod_id = $1
        AND dn.speaker_key IS NULL
        AND dn.speaker_formid_hex IS NOT NULL`,
    [modId],
  );
  return rowCount ?? 0;
};

/**
 * Speaker key of the remaining nodes, taken from the folder their audio ships in.
 *
 * Quest dialog usually picks its actor through an alias, so the voice folder is
 * the only speaker evidence such an INFO record carries.
 */
const keyNodesFromVoiceFolders = async (
  db: Tx,
  modId: number,
  voiceFolders: Map<string, string>,
): Promise<number> => {
  if (voiceFolders.size === 0) return 0;

  const lower6 = [...voiceFolders.keys()];
  const keys = lower6.map((formId) => voiceFolderSpeakerKey(voiceFolders.get(formId)!));

  const { rowCount } = await db.query(
    `UPDATE dialog_nodes dn
        SET speaker_key = u.speaker_key,
            updated_at = NOW()
       FROM dialog_topics dt,
            UNNEST($2::text[], $3::text[]) AS u(lower6, speaker_key)
      WHERE dt.id = dn.topic_id
        AND dt.mod_id = $1
        AND dn.speaker_key IS NULL
        AND upper(substring(dn.info_formid_hex from 3)) = u.lower6`,
    [modId, lower6, keys],
  );
  return rowCount ?? 0;
};

/**
 * Give one already-imported mod the speaker table it was imported without.
 *
 * Mirrors what an import does after its scene pass, reading the plugin only for
 * the actor facts that were never stored.
 *
 * @throws When the plugin the mod was imported from is no longer on disk.
 */
export const backfillModDialogSpeakers = async (
  db: Tx,
  target: DialogSpeakerBackfillTarget,
  opts: DialogSpeakerBackfillOptions = {},
): Promise<DialogSpeakerBackfillResult> => {
  if (!target.absPath) {
    throw new Error(`Mod ${target.modId} has no stored plugin path`);
  }

  if (opts.resetOverrides) {
    await db.query(
      `UPDATE dialog_speakers SET gender_override = NULL, updated_at = NOW() WHERE mod_id = $1`,
      [target.modId],
    );
  }

  const pluginPath = resolveModStoredPath(target.absPath);
  if (!fs.existsSync(pluginPath)) {
    throw new Error(`Plugin not found for mod ${target.modId}: ${pluginPath}`);
  }

  const esp = new EspReader(pluginPath, target.game);
  const storedByBasename = opts.storedByBasename ?? (await loadPluginPathByBasename(db));
  const voiceFolders = buildVoiceFolderMap(pluginPath);
  const localeSources = esp.info.isLocalized
    ? discoverLocaleSources(pluginPath, target.game, discoverArchiveCandidatesForPlugin(pluginPath))
    : [];

  const keyedFromActors = await keyNodesFromActorFormId(db, target.modId);
  const keyedFromVoice = await keyNodesFromVoiceFolders(db, target.modId, voiceFolders);

  const resolution = await resolveModDialogSpeakers(
    db,
    target.modId,
    buildPluginSpeakerIndex({
      actorIndex: buildSpeakerActorIndex(esp, target.game, storedByBasename),
      englishStrings: resolveEnglishLocaleMaps(localeSources)?.get('STRINGS') ?? null,
      npcReferenceNames: loadNpcReferenceMap(target.game),
      voiceFolders,
    }),
  );

  logImport.info(
    `Backfilled mod ${target.modId} "${target.modName}": ` +
      `${keyedFromActors + keyedFromVoice} node(s) keyed, ${resolution.speakers} speaker(s)`,
  );

  return {
    ...resolution,
    modId: target.modId,
    modName: target.modName,
    pluginPath,
    keyedNodes: keyedFromActors + keyedFromVoice,
  };
};

/**
 * Pull actor and voice-type facts from a plugin's master files.
 *
 * DLC plugins reuse vanilla voice folders such as `RobotMrHandy`, but the VTYP
 * records that gender them live in Fallout4.esm, not in the add-on itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import { EspReader, type EspActorIndex } from '../../formats/esp';
import { logImport } from '../../logging/loggers';
import { resolveModStoredPath } from '../../modStorage/paths';
import type { GameType } from '../../types';

/** Basename of a stored plugin path → the path itself. */
export const loadPluginPathByBasename = async (db: Tx): Promise<Map<string, string>> => {
  const { rows } = await db.query<{ basename: string; abs_path: string }>(
    `SELECT lower(regexp_replace(abs_path, '.*[/\\\\]', '')) AS basename, abs_path
       FROM mods
      WHERE abs_path IS NOT NULL`,
  );
  const map = new Map<string, string>();
  for (const row of rows) {
    if (!map.has(row.basename)) map.set(row.basename, row.abs_path);
  }
  return map;
};

/** Resolve one TES4 master to a readable plugin path, if any. */
export const resolveMasterPluginPath = (
  pluginPath: string,
  masterName: string,
  storedByBasename: Map<string, string>,
): string | null => {
  const local = path.join(path.dirname(pluginPath), masterName);
  if (fs.existsSync(local)) return local;

  const stored = storedByBasename.get(masterName.toLowerCase());
  if (!stored) return null;

  const resolved = resolveModStoredPath(stored);
  return fs.existsSync(resolved) ? resolved : null;
};

const mergeVoiceTypes = (
  merged: EspActorIndex['voiceTypes'],
  byEdid: Map<string, EspActorIndex['voiceTypes'][number]>,
): void => {
  for (const voiceType of merged) {
    if (!voiceType.edid) continue;
    byEdid.set(voiceType.edid.toLowerCase(), voiceType);
  }
};

/** Later indexes win on duplicate FormIDs; voice types merge by EDID. */
export const mergeActorIndexes = (indexes: EspActorIndex[]): EspActorIndex => {
  const actors = new Map<string, EspActorIndex['actors'][number]>();
  const voiceTypesByEdid = new Map<string, EspActorIndex['voiceTypes'][number]>();

  for (const index of indexes) {
    for (const actor of index.actors) actors.set(actor.formId, actor);
    mergeVoiceTypes(index.voiceTypes, voiceTypesByEdid);
  }

  return { actors: [...actors.values()], voiceTypes: [...voiceTypesByEdid.values()] };
};

/**
 * Actor index of one plugin plus every master it can read on disk.
 *
 * Masters are loaded first; the plugin itself wins on conflicts.
 */
export const buildSpeakerActorIndex = (
  esp: EspReader,
  game: GameType,
  storedByBasename: Map<string, string>,
): EspActorIndex => {
  const indexes: EspActorIndex[] = [];

  for (const masterName of esp.info.masterFiles) {
    const masterPath = resolveMasterPluginPath(esp.filePath, masterName, storedByBasename);
    if (!masterPath) continue;
    try {
      indexes.push(new EspReader(masterPath, game).extractActorIndex());
    } catch (err) {
      logImport.warn(
        `Master plugin ${masterName} skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  indexes.push(esp.extractActorIndex());
  return mergeActorIndexes(indexes);
};

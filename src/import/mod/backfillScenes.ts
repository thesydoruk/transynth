/**
 * Re-extract SCEN actions into an already-imported mod.
 *
 * Does not touch records, strings, or translations. Missing scenes in the
 * plugin are left in the graph so a bad extract cannot wipe dialog data.
 */
import fs from 'node:fs';
import type { Tx } from '../../db';
import type { DialogGraphImportContext } from '../bulk';
import type { PluginSpeakerIndex } from '../dialogSpeakers';
import { EspReader, sceneHasTimingConstraint, type SceneRecord } from '../../formats/esp';
import type { GameType } from '../../types';
import { importSceneRecords } from '../../../worker/src/jobs/import/mod/sceneImport';
import { loadModImportPaths } from './resolvePaths';

export type SceneBackfillTarget = {
  modId: number;
  name: string;
  game: GameType;
};

export type SceneBackfillResult = {
  modId: number;
  name: string;
  scenes: number;
  phases: number;
  actions: number;
  timingSensitive: number;
};

const GAMES_WITH_SCENES = new Set<GameType>(['fo4', 'fo76', 'sse']);

const isTes4Plugin = (pluginPath: string): boolean => {
  const fd = fs.openSync(pluginPath, 'r');
  try {
    const header = Buffer.alloc(4);
    fs.readSync(fd, header, 0, 4, 0);
    return header.toString('ascii') === 'TES4';
  } finally {
    fs.closeSync(fd);
  }
};

const emptySpeakerIndex = (): PluginSpeakerIndex => ({
  actors: new Map(),
  voiceFolders: new Map(),
  voiceTypeGenders: new Map(),
});

export const listModsForSceneBackfill = async (
  db: Tx,
  modId?: number,
): Promise<SceneBackfillTarget[]> => {
  const { rows } = await db.query<{ id: number; name: string; game: string }>(
    `SELECT DISTINCT ON (m.id)
        m.id,
        m.name,
        COALESCE(m.game, mi.game, 'fo4') AS game
     FROM mods m
     JOIN mod_imports mi ON mi.mod_id = m.id
     WHERE mi.status = 'completed'
       AND mi.mod_id IS NOT NULL
       AND ($1::int IS NULL OR m.id = $1)
       AND EXISTS (SELECT 1 FROM dialog_scenes ds WHERE ds.mod_id = m.id)
     ORDER BY m.id, mi.updated_at DESC`,
    [modId ?? null],
  );
  return rows
    .map((row) => ({
      modId: row.id,
      name: row.name,
      game: row.game as GameType,
    }))
    .filter((row) => GAMES_WITH_SCENES.has(row.game));
};

const loadGraphContext = async (db: Tx, modId: number): Promise<DialogGraphImportContext> => {
  const { rows } = await db.query<{ id: number; formid_hex: string; edid: string | null }>(
    `SELECT id, formid_hex, edid FROM dialog_topics WHERE mod_id = $1`,
    [modId],
  );
  const topicIdCache = new Map<string, number>();
  const dialogEdidByFormId = new Map<string, string>();
  for (const row of rows) {
    topicIdCache.set(row.formid_hex, row.id);
    if (row.edid?.trim()) dialogEdidByFormId.set(row.formid_hex, row.edid.trim());
  }
  return {
    dialogEdidByFormId,
    speakerMap: new Map(),
    voiceSpeakerMap: new Map(),
    voiceFolderMap: new Map(),
    speakerIndex: emptySpeakerIndex(),
    topicIdCache,
  };
};

const countExtract = (scenes: SceneRecord[]): Omit<SceneBackfillResult, 'modId' | 'name'> => {
  let phases = 0;
  let actions = 0;
  let timingSensitive = 0;
  for (const scene of scenes) {
    if (sceneHasTimingConstraint(scene.actions)) timingSensitive += 1;
    actions += scene.actions.length;
    for (const action of scene.actions) phases += action.topicFormIds.length;
  }
  return { scenes: scenes.length, phases, actions, timingSensitive };
};

/** Replace scene actions/phases from the plugin. Never deletes translations. */
export const backfillModScenes = async (
  db: Tx,
  target: SceneBackfillTarget,
  opts: { dryRun?: boolean } = {},
): Promise<SceneBackfillResult> => {
  const paths = await loadModImportPaths(db, { modId: target.modId });
  if (!isTes4Plugin(paths.pluginPath)) {
    throw new Error(`Not a TES4 plugin: ${paths.pluginPath}`);
  }
  const scenes = new EspReader(paths.pluginPath, target.game).extractScenes();
  if (opts.dryRun || scenes.length === 0) {
    return { modId: target.modId, name: target.name, ...countExtract(scenes) };
  }

  const ctx = await loadGraphContext(db, target.modId);
  await db.query('BEGIN');
  try {
    const imported = await importSceneRecords(db, target.modId, scenes, ctx, {
      pruneMissingScenes: false,
    });
    await db.query('COMMIT');
    return {
      modId: target.modId,
      name: target.name,
      scenes: imported.scenes,
      phases: imported.phases,
      actions: imported.actions,
      timingSensitive: imported.timingSensitive,
    };
  } catch (err) {
    try {
      await db.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
};

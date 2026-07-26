/**
 * Rebuild QUST / DLBR structure for mods imported before it was tracked.
 *
 * Re-reads each mod plugin for quest and branch records, stamps DIAL ownership
 * onto existing topics, and creates stub quests for scene parents.
 */
import fs from 'node:fs';
import type { Tx } from '../../db';
import { EspReader } from '../../formats/esp';
import { logImport } from '../../logging/loggers';
import { resolveModStoredPath } from '../../modStorage/paths';
import type { GameType } from '../../types';
import { importDialogStructure, type StructureImportResult } from './importStructure';

export type DialogStructureBackfillTarget = {
  modId: number;
  modName: string;
  game: GameType;
  absPath: string | null;
  topics: number;
  branches: number;
  quests: number;
};

export type DialogStructureBackfillResult = StructureImportResult & {
  modId: number;
  modName: string;
  pluginPath: string;
};

/**
 * Mods whose dialog graph could carry quest / branch structure.
 *
 * @param onlyMissing - Skip mods that already have branch rows.
 */
export const listDialogStructureBackfillTargets = async (
  db: Tx,
  onlyMissing = true,
): Promise<DialogStructureBackfillTarget[]> => {
  const { rows } = await db.query<{
    mod_id: number;
    mod_name: string;
    game: string;
    abs_path: string | null;
    topics: number;
    branches: number;
    quests: number;
  }>(
    `SELECT m.id AS mod_id, m.name AS mod_name, m.game, m.abs_path,
            count(DISTINCT dt.id)::int AS topics,
            (SELECT count(*)::int FROM dialog_branches db WHERE db.mod_id = m.id) AS branches,
            (SELECT count(*)::int FROM dialog_quests dq WHERE dq.mod_id = m.id) AS quests
       FROM mods m
       JOIN dialog_topics dt ON dt.mod_id = m.id
      GROUP BY m.id, m.name, m.game, m.abs_path
     HAVING NOT $1::boolean
         OR (SELECT count(*) FROM dialog_branches db WHERE db.mod_id = m.id) = 0
      ORDER BY topics DESC`,
    [onlyMissing],
  );

  return rows.map((row) => ({
    modId: row.mod_id,
    modName: row.mod_name,
    game: row.game as GameType,
    absPath: row.abs_path,
    topics: row.topics,
    branches: row.branches,
    quests: row.quests,
  }));
};

/** Collect quest FormIDs already stored on imported scenes. */
const loadSceneQuestFormIds = async (db: Tx, modId: number): Promise<string[]> => {
  const { rows } = await db.query<{ quest_formid_hex: string }>(
    `SELECT DISTINCT quest_formid_hex
       FROM dialog_scenes
      WHERE mod_id = $1
        AND quest_formid_hex IS NOT NULL`,
    [modId],
  );
  return rows.map((row) => row.quest_formid_hex);
};

/**
 * Import QUST / DLBR links for one mod from its stored plugin path.
 *
 * @throws When the plugin the mod was imported from is no longer on disk.
 */
export const backfillModDialogStructure = async (
  db: Tx,
  target: DialogStructureBackfillTarget,
): Promise<DialogStructureBackfillResult> => {
  if (!target.absPath) {
    throw new Error(`Mod ${target.modId} has no stored plugin path`);
  }

  const pluginPath = resolveModStoredPath(target.absPath);
  if (!fs.existsSync(pluginPath)) {
    throw new Error(`Plugin not found for mod ${target.modId}: ${pluginPath}`);
  }

  const esp = new EspReader(pluginPath, target.game);
  const structure = esp.extractDialogStructure();
  const sceneQuestFormIds = [
    ...new Set([
      ...esp
        .extractScenes()
        .map((scene) => scene.questFormId)
        .filter((id): id is string => id != null),
      ...(await loadSceneQuestFormIds(db, target.modId)),
    ]),
  ];

  const result = await importDialogStructure(db, target.modId, structure, sceneQuestFormIds);

  logImport.info(
    `Backfilled dialog structure for mod ${target.modId} "${target.modName}": ` +
      `${result.quests} quest(s), ${result.branches} branch(es), ${result.dialLinks} dial link(s)`,
  );

  return {
    ...result,
    modId: target.modId,
    modName: target.modName,
    pluginPath,
  };
};

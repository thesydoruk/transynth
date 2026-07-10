/**
 * Mod deletion — DB purge, import-job cleanup, and async file removal.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import { log } from '../../logger';
import { PATHS } from '../../paths';
import { deleteModDataForModIds } from '../data/queries';
import type { ModImportJob } from './modImportService';

const MOD_UPLOAD_DIR = PATHS.modUploads;

const modFilePath = (fileName: string) => {
  const safe = path.basename(fileName);
  return path.join(MOD_UPLOAD_DIR, safe);
};

const isInsideModUploadDir = (absPath: string): boolean => {
  const rel = path.relative(MOD_UPLOAD_DIR, absPath);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
};

const resolveExtractedRootDir = (pluginPath: string | null | undefined): string | null => {
  if (!pluginPath) return null;
  const absPluginPath = path.resolve(pluginPath);
  if (!isInsideModUploadDir(absPluginPath)) return null;

  let current =
    fs.existsSync(absPluginPath) && fs.statSync(absPluginPath).isDirectory()
      ? absPluginPath
      : path.dirname(absPluginPath);

  while (isInsideModUploadDir(current)) {
    if (path.basename(current).startsWith('_extracted_')) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
};

type ModImportJobRow = Pick<ModImportJob, 'id' | 'file_name' | 'esp_path' | 'mod_id'> & {
  abs_path?: string | null;
};

/** Remove upload/extract/PEX cache files after mod rows are gone from the DB. */
export const scheduleModDeleteFileCleanup = (
  jobs: ModImportJobRow[],
  modAbsPaths: Map<number, string | null>,
): void => {
  const filePaths = new Set<string>();
  const extractedDirs = new Set<string>();

  for (const job of jobs) {
    filePaths.add(modFilePath(job.file_name));
    if (job.esp_path) filePaths.add(job.esp_path);
    const fromJobEsp = resolveExtractedRootDir(job.esp_path);
    if (fromJobEsp) extractedDirs.add(fromJobEsp);
  }

  for (const [modId, absPath] of modAbsPaths) {
    if (absPath) filePaths.add(absPath);
    const fromModAbs = resolveExtractedRootDir(absPath);
    if (fromModAbs) extractedDirs.add(fromModAbs);
    extractedDirs.add(path.join(PATHS.pexDecompile, String(modId)));
    extractedDirs.add(path.join(PATHS.voicePreview, String(modId)));
  }

  setImmediate(() => {
    for (const filePath of filePaths) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* file may not exist */
      }
    }
    for (const dirPath of extractedDirs) {
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
};

export type DeleteModsCompletelyResult = {
  deletedMods: number;
  deletedRecords: number;
};

/**
 * Delete mods and all imported data in one DB transaction, then clean up files.
 */
export const deleteModsCompletely = async (
  db: Tx,
  modIds: number[],
): Promise<DeleteModsCompletelyResult> => {
  const uniqueIds = [...new Set(modIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (uniqueIds.length === 0) {
    return { deletedMods: 0, deletedRecords: 0 };
  }

  const started = Date.now();

  const { rows: existingMods } = await db.query<{ id: number; abs_path: string | null }>(
    `SELECT id, abs_path FROM mods WHERE id = ANY($1::int[])`,
    [uniqueIds],
  );
  const existingIds = existingMods.map((row) => row.id);
  if (existingIds.length === 0) {
    return { deletedMods: 0, deletedRecords: 0 };
  }

  const modAbsPaths = new Map(existingMods.map((row) => [row.id, row.abs_path]));

  const { rows: importJobs } = await db.query<ModImportJobRow>(
    `SELECT mi.id, mi.file_name, mi.esp_path, mi.mod_id
       FROM mod_imports mi
      WHERE mi.mod_id = ANY($1::int[])`,
    [existingIds],
  );

  await db.query(`DELETE FROM mod_imports WHERE mod_id = ANY($1::int[])`, [existingIds]);

  const { deletedRecords } = await deleteModDataForModIds(db, existingIds, 'mod');

  scheduleModDeleteFileCleanup(importJobs, modAbsPaths);

  log.info(
    `deleteModsCompletely modIds=${existingIds.join(',')} deletedRecords=${deletedRecords} ms=${Date.now() - started}`,
  );

  return { deletedMods: existingIds.length, deletedRecords };
};

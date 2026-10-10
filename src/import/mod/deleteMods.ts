/**
 * Complete mod deletion: drain imported rows in committed batches, then remove
 * import jobs and the mod row, then clean uploaded files off the event loop.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Tx } from '../../db';
import { log } from '../../logger';
import { PATHS } from '../../paths';
import {
  isOwnedModStoragePath,
  modImportLocalizeRoot,
  modImportPackOutputDir,
  modUploadedFilePath,
  resolveModImportExtractRoot,
} from '../../modStorage';
import { withPinnedModImportWriteLock } from '../locks';
import { deleteModDataOnClient, deleteModGraphAndRow } from '../../web/data/queries/modsDelete';
import { snapshotModsToReference } from '../../web/services/referenceHooks';
import type { ModImportJob } from './types';

type ModImportJobRow = Pick<ModImportJob, 'id' | 'file_name' | 'esp_path' | 'mod_id'> & {
  abs_path?: string | null;
};

const collectDeletePaths = (
  jobs: ModImportJobRow[],
  modAbsPaths: Map<number, string | null>,
): { filePaths: Set<string>; extractedDirs: Set<string> } => {
  const filePaths = new Set<string>();
  const extractedDirs = new Set<string>();

  for (const job of jobs) {
    filePaths.add(modUploadedFilePath(job.file_name));
    if (job.esp_path) {
      filePaths.add(job.esp_path);
      const fromJobEsp = resolveModImportExtractRoot(job.esp_path);
      if (fromJobEsp) {
        extractedDirs.add(fromJobEsp);
        extractedDirs.add(modImportLocalizeRoot(fromJobEsp));
      }
    }
  }

  for (const [modId, absPath] of modAbsPaths) {
    if (absPath) {
      filePaths.add(absPath);
      const fromModAbs = resolveModImportExtractRoot(absPath);
      if (fromModAbs) extractedDirs.add(fromModAbs);
    }
    extractedDirs.add(path.join(PATHS.pexDecompile, String(modId)));
    extractedDirs.add(path.join(PATHS.voicePreview, String(modId)));
    if (absPath) {
      const extractRoot = resolveModImportExtractRoot(absPath);
      if (extractRoot) {
        extractedDirs.add(modImportPackOutputDir(extractRoot));
        extractedDirs.add(modImportLocalizeRoot(extractRoot));
      }
    }
  }

  return { filePaths, extractedDirs };
};

/**
 * Remove upload/extract/PEX cache files for deleted mods. Plugin paths outside
 * mod storage belong to the user (scan:mods registers them in place) and are
 * left alone.
 */
export const removeModDeleteFiles = async (
  jobs: ModImportJobRow[],
  modAbsPaths: Map<number, string | null>,
): Promise<void> => {
  const { filePaths, extractedDirs } = collectDeletePaths(jobs, modAbsPaths);

  for (const filePath of filePaths) {
    if (!isOwnedModStoragePath(filePath)) {
      log.debug(`deleteMods: keeping ${filePath} — outside mod storage`);
      continue;
    }
    await fs.unlink(filePath).catch(() => undefined);
  }
  for (const dirPath of extractedDirs) {
    await fs.rm(dirPath, { recursive: true, force: true }).catch(() => undefined);
  }
};

/** Remove mod files off the event loop after mod rows are gone from the DB. */
export const scheduleModDeleteFileCleanup = (
  jobs: ModImportJobRow[],
  modAbsPaths: Map<number, string | null>,
): void => {
  setImmediate(() => {
    void removeModDeleteFiles(jobs, modAbsPaths);
  });
};

export type DeleteModsCompletelyResult = {
  deletedMods: number;
  deletedRecords: number;
  /** Reviewed/human translations copied into the reference base before the purge. */
  referencePromoted: number;
};

export type DeleteModsOptions = {
  /** Copy reviewed/human translations into the reference base first. Default true. */
  keepReference?: boolean;
};

/**
 * Delete mods and imported data. Records are purged first (committed per
 * batch); import jobs stay until that finishes so a timed-out request can retry.
 */
export const deleteModsCompletely = async (
  db: Tx,
  modIds: number[],
  options: DeleteModsOptions = {},
): Promise<DeleteModsCompletelyResult> => {
  const uniqueIds = [...new Set(modIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (uniqueIds.length === 0) {
    return { deletedMods: 0, deletedRecords: 0, referencePromoted: 0 };
  }

  const started = Date.now();

  return withPinnedModImportWriteLock(db, async (client) => {
    const { rows: existingMods } = await client.query<{
      id: number;
      abs_path: string | null;
      name: string;
    }>(`SELECT id, abs_path, name FROM mods WHERE id = ANY($1::int[])`, [uniqueIds]);
    const existingIds = existingMods.map((row) => row.id);
    if (existingIds.length === 0) {
      return { deletedMods: 0, deletedRecords: 0, referencePromoted: 0 };
    }

    const referencePromoted =
      options.keepReference === false ? 0 : await snapshotModsToReference(client, existingIds);

    const modAbsPaths = new Map(existingMods.map((row) => [row.id, row.abs_path]));
    const { rows: importJobs } = await client.query<ModImportJobRow>(
      `SELECT mi.id, mi.file_name, mi.esp_path, mi.mod_id
         FROM mod_imports mi
        WHERE mi.mod_id = ANY($1::int[])`,
      [existingIds],
    );

    const { deletedRecords } = await deleteModDataOnClient(client, existingIds, 'rows');
    await client.query(`DELETE FROM mod_imports WHERE mod_id = ANY($1::int[])`, [existingIds]);
    await deleteModGraphAndRow(client, existingIds);

    scheduleModDeleteFileCleanup(importJobs, modAbsPaths);

    log.info(
      `deleteModsCompletely modIds=${existingIds.join(',')} deletedRecords=${deletedRecords} referencePromoted=${referencePromoted} ms=${Date.now() - started}`,
    );

    return { deletedMods: existingIds.length, deletedRecords, referencePromoted };
  });
};

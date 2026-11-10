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
  isVortexExtractRoot,
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
  keptRoots: ReadonlySet<string>,
): { filePaths: Set<string>; extractedDirs: Set<string> } => {
  const filePaths = new Set<string>();
  const extractedDirs = new Set<string>();
  const kept = new Set([...keptRoots].map((root) => path.resolve(root)));
  /** The tree a path lives in (null: none), or KEEP when another mod still imports from it. */
  const KEEP = Symbol('keep');
  const ownRoot = (filePath: string): string | null | typeof KEEP => {
    const root = resolveModImportExtractRoot(filePath);
    if (root && kept.has(path.resolve(root))) return KEEP;
    return root;
  };

  for (const job of jobs) {
    const root = job.esp_path ? ownRoot(job.esp_path) : null;
    if (root === KEEP) continue;
    // A Vortex pack is stored as `<tree>.zip` beside its tree, never under uploads/mod.
    if (root && isVortexExtractRoot(root)) filePaths.add(`${root}.zip`);
    else filePaths.add(modUploadedFilePath(job.file_name));
    if (job.esp_path) filePaths.add(job.esp_path);
    if (root) {
      extractedDirs.add(root);
      extractedDirs.add(modImportLocalizeRoot(root));
    }
  }

  for (const [modId, absPath] of modAbsPaths) {
    extractedDirs.add(path.join(PATHS.pexDecompile, String(modId)));
    extractedDirs.add(path.join(PATHS.voicePreview, String(modId)));
    if (!absPath) continue;
    const root = ownRoot(absPath);
    if (root === KEEP) continue;
    filePaths.add(absPath);
    if (root) {
      extractedDirs.add(root);
      extractedDirs.add(modImportPackOutputDir(root));
      extractedDirs.add(modImportLocalizeRoot(root));
    }
  }

  return { filePaths, extractedDirs };
};

/**
 * The extract trees among `jobs` that import jobs left in the DB still read
 * from: the plugins of one Vortex folder share one tree, and deleting one of
 * those mods must not pull the files from under the others.
 */
export const findExtractRootsInUse = async (
  db: Tx,
  jobs: ModImportJobRow[],
): Promise<Set<string>> => {
  const roots = [
    ...new Set(
      jobs
        .map((job) => (job.esp_path ? resolveModImportExtractRoot(job.esp_path) : null))
        .filter((root): root is string => root != null),
    ),
  ];
  const inUse = new Set<string>();
  for (const root of roots) {
    const { rows } = await db.query(
      `SELECT 1 FROM mod_imports WHERE starts_with(esp_path, $1) LIMIT 1`,
      [root + path.sep],
    );
    if (rows.length > 0) inUse.add(root);
  }
  return inUse;
};

/**
 * Remove upload/extract/PEX cache files for deleted mods. Plugin paths outside
 * mod storage belong to the user (scan:mods registers them in place) and are
 * left alone, and so is a tree in `keptRoots` (other mods still use it).
 */
export const removeModDeleteFiles = async (
  jobs: ModImportJobRow[],
  modAbsPaths: Map<number, string | null>,
  keptRoots: ReadonlySet<string> = new Set(),
): Promise<void> => {
  const { filePaths, extractedDirs } = collectDeletePaths(jobs, modAbsPaths, keptRoots);

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
  keptRoots: ReadonlySet<string> = new Set(),
): void => {
  setImmediate(() => {
    void removeModDeleteFiles(jobs, modAbsPaths, keptRoots);
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

    const keptRoots = await findExtractRootsInUse(client, importJobs);
    scheduleModDeleteFileCleanup(importJobs, modAbsPaths, keptRoots);

    log.info(
      `deleteModsCompletely modIds=${existingIds.join(',')} deletedRecords=${deletedRecords} referencePromoted=${referencePromoted} ms=${Date.now() - started}`,
    );

    return { deletedMods: existingIds.length, deletedRecords, referencePromoted };
  });
};

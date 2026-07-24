import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import {
  modImportLocalizeDir,
  modImportLocalizeRoot,
  modImportPackOutputDir,
  resolveModImportExtractRoot,
  resolveModStoredPath,
} from '../../modStorage';
import type { GameType } from '../../types';
import { getModImportJob, type ModImportJob } from './modImport';

export type ModImportPaths = {
  jobId: number;
  modId: number;
  fileName: string;
  game: GameType;
  extractDir: string;
  pluginPath: string;
  targetLang: string;
  localizeRoot: string;
  localizeDir: string;
  packOutputDir: string;
};

export const pathsFromModImportJob = (job: ModImportJob): ModImportPaths => {
  if (!job.esp_path) {
    throw new Error(`Import job #${job.id} has no plugin path`);
  }

  // DB may store absolute paths from another host/OS (e.g. Windows import → Linux server).
  const pluginPath = resolveModStoredPath(job.esp_path);
  if (!fs.existsSync(pluginPath)) {
    throw new Error(`Plugin file not found for import job #${job.id}: ${pluginPath}`);
  }

  const extractDir = resolveModStoredPath(
    job.extract_dir?.trim() || resolveModImportExtractRoot(pluginPath) || path.dirname(pluginPath),
  );

  if (!fs.existsSync(extractDir)) {
    throw new Error(`Extract directory not found for import job #${job.id}: ${extractDir}`);
  }

  if (job.mod_id == null) {
    throw new Error(`Import job #${job.id} has no linked mod`);
  }

  const targetLang = job.tgt_lang?.trim() || CONFIG.defaultTgtLang;

  return {
    jobId: job.id,
    modId: job.mod_id,
    fileName: job.file_name,
    game: job.game,
    extractDir,
    pluginPath,
    targetLang,
    localizeRoot: modImportLocalizeRoot(extractDir),
    localizeDir: modImportLocalizeDir(extractDir, targetLang),
    packOutputDir: modImportPackOutputDir(extractDir),
  };
};

export type LoadModImportPathsOptions = {
  jobId?: number;
  modId?: number;
};

/** Load the newest import job for a mod id or fetch by job id. */
export const loadModImportPaths = async (
  db: Tx,
  options: LoadModImportPathsOptions,
): Promise<ModImportPaths> => {
  if (options.jobId != null) {
    const job = await getModImportJob(db, options.jobId);
    if (!job) throw new Error(`Import job not found: ${options.jobId}`);
    return pathsFromModImportJob(job);
  }

  if (options.modId != null) {
    const { rows } = await db.query<ModImportJob>(
      `SELECT id, file_name, file_hash, mod_id, total_records, imported_records, status,
              src_lang, tgt_lang, is_localized, game, esp_path, extract_dir,
              nexus_mod_id, source_folder, nexus_mod_name, created_at, updated_at
       FROM mod_imports WHERE mod_id = $1 ORDER BY updated_at DESC LIMIT 1`,
      [options.modId],
    );
    const job = rows[0] ? ({ ...rows[0], archive_manifest: null } as ModImportJob) : undefined;
    if (!job) {
      throw new Error(`No import job found for mod id ${options.modId}`);
    }
    return pathsFromModImportJob(job);
  }

  throw new Error('Specify --job-id or --mod-id');
};

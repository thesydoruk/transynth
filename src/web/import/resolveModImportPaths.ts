import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import {
  modImportLocalizeDir,
  modImportPackOutputDir,
  resolveModImportExtractRoot,
} from '../../modStorage';
import type { GameType } from '../../types';
import { getModImportJob, type ModImportJob } from './modImportService';

export type ModImportPaths = {
  jobId: number;
  modId: number;
  fileName: string;
  game: GameType;
  extractDir: string;
  pluginPath: string;
  localizeDir: string;
  packOutputDir: string;
};

export const pathsFromModImportJob = (job: ModImportJob): ModImportPaths => {
  if (!job.esp_path) {
    throw new Error(`Import job #${job.id} has no plugin path`);
  }
  if (!fs.existsSync(job.esp_path)) {
    throw new Error(`Plugin file not found for import job #${job.id}: ${job.esp_path}`);
  }

  const extractDir =
    job.extract_dir?.trim() ||
    resolveModImportExtractRoot(job.esp_path) ||
    path.dirname(job.esp_path);

  if (!fs.existsSync(extractDir)) {
    throw new Error(`Extract directory not found for import job #${job.id}: ${extractDir}`);
  }

  if (job.mod_id == null) {
    throw new Error(`Import job #${job.id} has no linked mod`);
  }

  return {
    jobId: job.id,
    modId: job.mod_id,
    fileName: job.file_name,
    game: job.game,
    extractDir,
    pluginPath: job.esp_path,
    localizeDir: modImportLocalizeDir(extractDir),
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
      `SELECT * FROM mod_imports WHERE mod_id = $1 ORDER BY updated_at DESC LIMIT 1`,
      [options.modId],
    );
    const job = rows[0];
    if (!job) {
      throw new Error(`No import job found for mod id ${options.modId}`);
    }
    return pathsFromModImportJob(job);
  }

  throw new Error('Specify --job-id or --mod-id');
};

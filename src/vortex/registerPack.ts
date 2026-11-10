import path from 'node:path';
import type { Tx } from '../db';
import { readPluginMasterNames } from '../formats/esp';
import { gamePlugin } from '../games/registry';
import { discoverModFiles } from '../import/mod/discovery';
import { extractGameArchivesForImport } from '../import/mod/extract';
import { filterPrimaryPlugins } from '../import/mod/importAnchor';
import { getModImportJob } from '../import/mod/jobs';
import { registerArchiveFile, insertModImportJob } from '../import/mod/registration';
import type { ModImportJob, ModScanContext } from '../import/mod/types';
import { extractArchive } from '../tools/archiveUtils';
import type { GameId } from '../types';
import { scopedVortexFileHash } from './groupKey';
import { comparePluginNames, pickPrimaryPlugin } from './primaryPlugin';

export type VortexPackParams = {
  groupId: number;
  fileName: string;
  zipPath: string;
  extractDir: string;
  contentHash: string;
  srcLang: string;
  tgtLang: string;
  game: GameId;
  nexusModId?: number | null;
  nexusModName?: string | null;
  sourceFolder?: string | null;
  /** The plugins the agent found in the folder; more than one means one job each. */
  plugins?: readonly string[] | null;
  /** The agent's choice of the folder's main plugin. */
  pluginFileName?: string | null;
};

export type VortexPackJob = { plugin: string | null; job: ModImportJob };

/** What a folder upload registered: its main job first, then one per further plugin. */
export type VortexPackJobs = { primary: ModImportJob; jobs: VortexPackJob[] };

/** One plugin of a multi-plugin folder: `v<group>:<content hash>:<plugin stem>`. */
export const vortexPluginFileHash = (scopedHash: string, pluginFileName: string): string =>
  `${scopedHash}:${path.basename(pluginFileName, path.extname(pluginFileName)).toLowerCase()}`;

const scanContext = (params: VortexPackParams): ModScanContext => ({
  nexusModId: params.nexusModId ?? undefined,
  nexusModName: params.nexusModName ?? undefined,
  sourceFolder: params.sourceFolder ?? undefined,
  vortexGroupId: params.groupId,
});

const listFolderJobs = async (db: Tx, scopedHash: string): Promise<ModImportJob[]> => {
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM mod_imports
      WHERE file_hash = $1 OR starts_with(file_hash, $1 || ':')
      ORDER BY import_extras DESC, id`,
    [scopedHash],
  );
  const jobs = await Promise.all(rows.map((row) => getModImportJob(db, row.id)));
  return jobs.filter((job): job is ModImportJob => job != null);
};

const asPackJobs = (jobs: ModImportJob[]): VortexPackJobs => ({
  primary: jobs[0]!,
  jobs: jobs.map((job) => ({ plugin: job.esp_path ? path.basename(job.esp_path) : null, job })),
});

const choosePrimary = (plugins: string[], hinted?: string | null): string => {
  const hint = hinted?.toLowerCase();
  const byHint = hint ? plugins.find((p) => path.basename(p).toLowerCase() === hint) : undefined;
  if (byHint) return byHint;
  const withMasters = plugins.map((p) => {
    try {
      return { fileName: p, masters: readPluginMasterNames(p).map((m) => m.toLowerCase()) };
    } catch {
      return { fileName: p, masters: [] };
    }
  });
  // Masters are named by file name, so compare on basenames.
  const picked = pickPrimaryPlugin(
    withMasters.map((p) => ({ fileName: path.basename(p.fileName), masters: p.masters })),
  );
  return plugins.find((p) => path.basename(p) === picked) ?? plugins[0]!;
};

/**
 * A folder with several plugins: unpack it once, then one job per plugin, all
 * reading from the same tree. Only the main plugin's job imports the folder's
 * loose text and videos, so they land in one mod instead of every plugin's.
 */
const registerFolderPlugins = async (
  db: Tx,
  params: VortexPackParams,
  scopedHash: string,
): Promise<VortexPackJobs> => {
  await extractArchive(params.zipPath, params.extractDir);
  const manifest = extractGameArchivesForImport({
    extractRoot: params.extractDir,
    container: { fileName: params.fileName, archivePath: params.zipPath },
    scopeDirs: [params.extractDir],
  });
  const plugins = filterPrimaryPlugins(discoverModFiles(params.extractDir).plugins).sort((a, b) =>
    comparePluginNames(path.basename(a), path.basename(b)),
  );
  if (plugins.length === 0) {
    throw new Error(`Archive holds no files this game can import (${params.game})`);
  }
  const primary = choosePrimary(plugins, params.pluginFileName);
  const importAdapter = gamePlugin(params.game).import;
  // Read every plugin before inserting any job, so a bad one leaves no half-registered folder.
  const described = [primary, ...plugins.filter((p) => p !== primary)].map((plugin) => ({
    plugin,
    anchor: importAdapter.describeAnchor(plugin, params.extractDir),
  }));
  for (const { plugin, anchor } of described) {
    await insertModImportJob(db, {
      fileName: params.fileName,
      fileHash: vortexPluginFileHash(scopedHash, plugin),
      totalRecords: anchor.totalRecords,
      srcLang: params.srcLang,
      tgtLang: params.tgtLang,
      isLocalized: anchor.isLocalized ? 1 : 0,
      game: params.game,
      espPath: plugin,
      extractDir: manifest.extractRoot,
      scan: scanContext(params),
      importExtras: plugin === primary,
    });
  }
  return asPackJobs(await listFolderJobs(db, scopedHash));
};

/**
 * Register one uploaded unit. A folder with one plugin (or none) is one job, as
 * it always was; a folder with several becomes one job per plugin. Uploading
 * the same content again returns the jobs it already has.
 */
export const registerVortexPack = async (
  db: Tx,
  params: VortexPackParams,
): Promise<VortexPackJobs> => {
  const scopedHash = scopedVortexFileHash(params.groupId, params.contentHash);
  if ((params.plugins?.length ?? 0) > 1) {
    const existing = await listFolderJobs(db, scopedHash);
    if (existing.length > 0) return asPackJobs(existing);
    return registerFolderPlugins(db, params, scopedHash);
  }

  // One plugin or none: one job, as always (an existing one is returned as is).
  const job = await registerArchiveFile(
    db,
    params.fileName,
    params.zipPath,
    params.extractDir,
    params.srcLang,
    params.tgtLang,
    params.game,
    scanContext(params),
    scopedHash,
  );
  return asPackJobs([job]);
};

export const vortexExtractDir = (root: string, scopedHash: string): string =>
  path.join(root, scopedHash.replace(/[^a-zA-Z0-9._-]+/g, '_'));

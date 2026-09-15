/**
 * Turning an upload into a `mod_imports` job row.
 *
 * Hashing, de-duplicating, extracting, and inserting the row are the same for
 * every game. Which file anchors the import, whether the mod is localized, and
 * how many records to expect are answered by the game's import adapter.
 */
import path from 'node:path';
import { extractArchive } from '../../tools/archiveUtils';
import type { Tx } from '../../db';
import { gamePlugin } from '../../games/registry';
import { sha1HexFile } from '../../utils/hash';
import { DEFAULT_GAME_ID } from '../../games/registry';
import type { GameId } from '../../types';
import {
  collectPluginArchiveScopeDirs,
  extractGameArchivesForImport,
  resolveModImportExtractRoot,
} from './extract';
import { getModImportJobByFileHash } from './jobs';
import { discoverArchiveCandidatesForPlugin } from './discovery';
import type { ModImportJob, ModScanContext } from './types';

const patchModImportScanContext = async (
  db: Tx,
  fileHash: string,
  scan?: ModScanContext,
): Promise<void> => {
  if (!scan?.nexusModId && !scan?.sourceFolder) return;
  await db.query(
    `UPDATE mod_imports SET
       nexus_mod_id = COALESCE(nexus_mod_id, $1),
       source_folder = COALESCE(source_folder, $2),
       nexus_mod_name = COALESCE(nexus_mod_name, $3),
       updated_at = NOW()
     WHERE file_hash = $4`,
    [scan.nexusModId ?? null, scan.sourceFolder ?? null, scan.nexusModName ?? null, fileHash],
  );
};

const insertModImportJob = async (
  db: Tx,
  params: {
    fileName: string;
    fileHash: string;
    totalRecords: number;
    srcLang: string;
    tgtLang: string;
    isLocalized: number;
    game: GameId;
    espPath: string;
    extractDir?: string | null;
    scan?: ModScanContext;
  },
): Promise<ModImportJob> => {
  await db.query(
    `INSERT INTO mod_imports(
       file_name, file_hash, mod_id, total_records, status,
       src_lang, tgt_lang, is_localized, game, esp_path,
       extract_dir, archive_manifest,
       nexus_mod_id, source_folder, nexus_mod_name, vortex_group_id
     ) VALUES ($1, $2, NULL, $3, 'pending', $4, $5, $6, $7, $8, $9, NULL, $10, $11, $12, $13)`,
    [
      params.fileName,
      params.fileHash,
      params.totalRecords,
      params.srcLang,
      params.tgtLang,
      params.isLocalized,
      params.game,
      params.espPath,
      params.extractDir ?? null,
      params.scan?.nexusModId ?? null,
      params.scan?.sourceFolder ?? null,
      params.scan?.nexusModName ?? null,
      params.scan?.vortexGroupId ?? null,
    ],
  );

  const job = await getModImportJobByFileHash(db, params.fileHash);
  if (!job) throw new Error('Failed to load mod import job after insert');
  return job;
};

/**
 * Register a plugin upload as a mod import job.
 *
 * Scans the plugin only far enough to size the job; call `runModImport` to
 * actually ingest it.
 */
export const registerPluginFile = async (
  db: Tx,
  fileName: string,
  pluginPath: string,
  srcLang: string,
  tgtLang: string,
  game: GameId = DEFAULT_GAME_ID,
  scan?: ModScanContext,
): Promise<ModImportJob> => {
  const fileHash = await sha1HexFile(pluginPath);

  const existing = await getModImportJobByFileHash(db, fileHash);
  if (existing) {
    await patchModImportScanContext(db, fileHash, scan);
    return (await getModImportJobByFileHash(db, fileHash))!;
  }

  const extractRoot = resolveModImportExtractRoot(pluginPath) ?? path.dirname(pluginPath);
  const manifest = extractGameArchivesForImport({
    extractRoot,
    scopeDirs: collectPluginArchiveScopeDirs(pluginPath, discoverArchiveCandidatesForPlugin),
  });

  const anchor = gamePlugin(game).import.describeAnchor(pluginPath, extractRoot);

  return insertModImportJob(db, {
    fileName,
    fileHash,
    totalRecords: anchor.totalRecords,
    srcLang,
    tgtLang,
    isLocalized: anchor.isLocalized ? 1 : 0,
    game,
    espPath: pluginPath,
    extractDir: manifest.extractRoot,
    scan,
  });
};

/**
 * Register an archive upload as a mod import job.
 *
 * The archive is extracted, then the game's adapter picks the anchor inside it.
 * This does not ingest strings — call `runModImport` to perform the import.
 */
export const registerArchiveFile = async (
  db: Tx,
  fileName: string,
  archivePath: string,
  extractDir: string,
  srcLang: string,
  tgtLang: string,
  game: GameId = DEFAULT_GAME_ID,
  scan?: ModScanContext,
  fileHashOverride?: string,
): Promise<ModImportJob> => {
  const fileHash = fileHashOverride ?? (await sha1HexFile(archivePath));

  const existing = await getModImportJobByFileHash(db, fileHash);
  if (existing) {
    await patchModImportScanContext(db, fileHash, scan);
    return (await getModImportJobByFileHash(db, fileHash))!;
  }

  await extractArchive(archivePath, extractDir);

  const manifest = extractGameArchivesForImport({
    extractRoot: extractDir,
    container: { fileName, archivePath },
    scopeDirs: [extractDir],
  });

  const importAdapter = gamePlugin(game).import;
  const anchorPath = importAdapter.selectAnchor(extractDir);
  if (!anchorPath) {
    throw new Error(`Archive holds no files this game can import (${game})`);
  }
  const anchor = importAdapter.describeAnchor(anchorPath, extractDir);

  return insertModImportJob(db, {
    fileName,
    fileHash,
    totalRecords: anchor.totalRecords,
    srcLang,
    tgtLang,
    isLocalized: anchor.isLocalized ? 1 : 0,
    game,
    espPath: anchorPath,
    extractDir: manifest.extractRoot,
    scan,
  });
};

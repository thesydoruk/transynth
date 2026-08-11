import path from 'node:path';
import { extractArchive } from '../../tools/archiveUtils';
import type { Tx } from '../../db';
import { sha1HexFile } from '../../utils/hash';
import { EspReader } from '../../formats/esp';
import { resolveModDirectoryFromPath } from '../../formats/mcm';
import type { GameType } from '../../types';
import { discoverLocaleSources } from './localeSources';
import { estimateLocalizedImportTotal } from './localeRows';
import {
  collectPluginArchiveScopeDirs,
  extractGameArchivesForImport,
  resolveModImportExtractRoot,
} from './extract';
import { getModImportJobByFileHash } from './jobs';
import { discoverArchiveCandidatesForPlugin } from './discovery';
import { selectArchiveImportAnchor } from './importAnchor';
import { countMcmTranslationRecords } from './mcmLocales';
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
    game: GameType;
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
       nexus_mod_id, source_folder, nexus_mod_name
     ) VALUES ($1, $2, NULL, $3, 'pending', $4, $5, $6, $7, $8, $9, NULL, $10, $11, $12)`,
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
    ],
  );

  const job = await getModImportJobByFileHash(db, params.fileHash);
  if (!job) throw new Error('Failed to load mod import job after insert');
  return job;
};

/**
 * Register a plugin upload as a mod import job.
 *
 * This performs a lightweight scan to determine whether the plugin is localized
 * and to compute the number of translatable rows (used as initial job total).
 * It does not ingest strings — call {@link runModImport} to perform the import.
 */
export const registerPluginFile = async (
  db: Tx,
  fileName: string,
  pluginPath: string,
  srcLang: string,
  tgtLang: string,
  game: GameType = 'fo4',
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

  const esp = new EspReader(pluginPath, game);
  const espRows = esp.extractStrings();
  const isLocalized = esp.info.isLocalized ? 1 : 0;

  let totalRecords = espRows.length;
  if (isLocalized) {
    const localeSources = discoverLocaleSources(
      pluginPath,
      game,
      discoverArchiveCandidatesForPlugin(pluginPath),
    );
    if (localeSources.length > 0) {
      totalRecords = estimateLocalizedImportTotal(
        espRows,
        localeSources,
        localeSources.map((s) => s.locale),
        game,
      );
    }
  }

  return insertModImportJob(db, {
    fileName,
    fileHash,
    totalRecords,
    srcLang,
    tgtLang,
    isLocalized,
    game,
    espPath: pluginPath,
    extractDir: manifest.extractRoot,
    scan,
  });
};

/**
 * Register an archive upload as a mod import job.
 *
 * The archive is extracted into `extractDir`, then a primary plugin (if any) or
 * an MCM translation file is used as the import anchor. Optional/fomod plugins
 * alone do not block MCM-only packages.
 *
 * This does not ingest strings — call {@link runModImport} to perform the import.
 */
export const registerArchiveFile = async (
  db: Tx,
  fileName: string,
  archivePath: string,
  extractDir: string,
  srcLang: string,
  tgtLang: string,
  game: GameType = 'fo4',
  scan?: ModScanContext,
): Promise<ModImportJob> => {
  const fileHash = await sha1HexFile(archivePath);

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

  const { anchorPath, isPlugin } = selectArchiveImportAnchor(extractDir);

  if (!isPlugin) {
    const modDir = resolveModDirectoryFromPath(anchorPath);
    const totalRecords = countMcmTranslationRecords(modDir, anchorPath);

    return insertModImportJob(db, {
      fileName,
      fileHash,
      totalRecords,
      srcLang,
      tgtLang,
      isLocalized: 0,
      game,
      espPath: anchorPath,
      extractDir: manifest.extractRoot,
      scan,
    });
  }

  const esp = new EspReader(anchorPath, game);
  const espRows = esp.extractStrings();
  const isLocalized = esp.info.isLocalized ? 1 : 0;

  let totalRecords = espRows.length;
  if (isLocalized) {
    const localeSources = discoverLocaleSources(
      anchorPath,
      game,
      discoverArchiveCandidatesForPlugin(anchorPath),
    );
    if (localeSources.length > 0) {
      totalRecords = estimateLocalizedImportTotal(
        espRows,
        localeSources,
        localeSources.map((s) => s.locale),
        game,
      );
    }
  }

  return insertModImportJob(db, {
    fileName,
    fileHash,
    totalRecords,
    srcLang,
    tgtLang,
    isLocalized,
    game,
    espPath: anchorPath,
    extractDir: manifest.extractRoot,
    scan,
  });
};

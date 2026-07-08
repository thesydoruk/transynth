/**
 * modImportService.ts
 *
 * Native mod import pipeline used by the web UI.
 *
 * Inputs:
 * - a plugin file (`.esp/.esm/.esl`) or
 * - an archive (`.zip/.7z/.rar`) containing a plugin plus its associated assets
 *   (BA2/BSA archives and/or loose `Strings\\` files).
 *
 * Outputs:
 * - a `mod_imports` job row tracking progress and resumability,
 * - and ingested `records` + `strings` rows in the database for later
 *   translation, review, and export.
 *
 * Key features:
 * - multi-format extraction (7z for zip/7z, optional system `unrar` for rar),
 * - automatic discovery of BA2/BSA companions,
 * - locale enumeration for localized mods,
 * - and pause/cancel controls via an in-memory active-job registry.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import Seven from 'node-7z';
import { path7za } from '7zip-bin';
import pg from 'pg';
import { upsertMod, upsertDialogScene, upsertDialogScenePhase, type Tx } from '../../db';
import { sha1Hex } from '../../utils/hash';
import { mapWithConcurrency } from '../../utils/concurrency';
import { CONFIG } from '../../config';
import { logImport } from '../../logging/loggers';
import { EspReader, type EspStringRow } from '../../formats/esp';
import { isBa2GnrArchive, getBa2Reader, clearBa2Cache } from '../../formats/ba2';
import {
  parseMcmBuffer,
  mcmLocaleFromPath,
  resolveMcmLocaleKey,
  resolveMcmModPrefix,
  resolveMcmTranslationPrefixes,
  listMcmTranslationDirs,
  isMcmTranslationArchivePath,
  mcmTranslationMatchesMod,
  hasMcmTranslationFiles,
  findFirstMcmTranslationFile,
  resolveModDirectoryFromPath,
  loadMcmLocalesFromConfigJson,
  MCM_LOCALE_ALIASES,
} from '../../formats/mcm';
import {
  formatPexStringContext,
  parsePexBuffer,
  pexScriptKeyFromInfo,
  locatePexLiteralInPsc,
  serializePexStoredContext,
  extractQuotedStringLiteralsFromPsc,
  isPexLiteralTranslatable,
  type PexStringUsage,
} from '../../formats/pex';
import { loadNpcReferenceMap } from '../../formats/subrecords';
import type { CsvRow, GameType } from '../../types';
import { parseVortexModFolder, resolveVortexFolderFromPath } from '../../utils/vortexFolder';
import type { VortexFolderInfo } from '../../utils/vortexFolder';
import {
  bulkInsertModImportRows,
  bulkUpsertImportTranslations,
  bulkUpsertDialogGraphForImportBatch,
  pruneStaleModImportData,
  sqlConvertImportedStringsToTranslations,
  trackModImportBulkResults,
  type ModImportBulkResult,
  type ModImportBulkRow,
  type DialogGraphImportContext,
} from './modImportBulk';
import {
  discoverLocaleSources,
  localeSourcesByLocale,
  loadLocaleStrings,
  generateImportCsvRows,
  estimateLocalizedImportTotal,
  resolveEnglishLocaleSource,
} from './modImportLocaleStream';
import {
  tryBeginDeferredImportIndexes,
  restoreDeferredImportIndexes,
  withModImportWriteLock,
  isPgDeadlockError,
} from './modImportIndexes';
import { ensureChampollionInstalled } from '../../tools/installTools';
import { decompilePexScriptMap, type DecompiledPexScript } from '../export/pexDecompileService';

const { Pool } = pg;

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * Import job row stored in the `mod_imports` table.
 *
 * A job is keyed by the file hash of the uploaded artifact (plugin or archive).
 * This makes imports resumable and prevents duplicate work when the same file
 * is uploaded multiple times.
 */
export interface ModImportJob {
  id: number;
  file_name: string;
  file_hash: string;
  mod_id: number | null;
  total_records: number;
  imported_records: number;
  status: string; // pending | extracting | in_progress | paused | failed | completed
  src_lang: string;
  tgt_lang: string;
  is_localized: number; // 0 | 1
  game: GameType;
  esp_path: string | null;
  nexus_mod_id: number | null;
  source_folder: string | null;
  nexus_mod_name: string | null;
  created_at: string;
  updated_at: string;
}

/** Optional Vortex/Nexus hints collected during folder scans. */
export interface ModScanContext {
  nexusModId?: number;
  nexusModName?: string;
  sourceFolder?: string;
}

export const modScanContextFromVortex = (vortex?: VortexFolderInfo): ModScanContext | undefined => {
  if (!vortex) return undefined;
  return {
    nexusModId: vortex.nexusModId,
    nexusModName: vortex.modName,
    sourceFolder: vortex.folderName,
  };
};

/**
 * Small preview row used by the UI to show a sample of extracted strings
 * before running a full import.
 */
export interface ModPreviewRow {
  formId: string;
  signature: string;
  edid: string;
  path: string;
  source: string;
}

/**
 * Canonical imported-row shape consumed by translation-apply matching.
 *
 * These rows mirror the subset of `records + strings` fields that the
 * matcher needs, but they are produced directly from an import job on disk
 * so the translation mod does not have to be ingested into the database.
 */
export interface ModImportApplyRow {
  formid_hex: string;
  path: string;
  path_simplified: string;
  signature: string | null;
  edid: string | null;
  text_raw: string;
}

/**
 * Progress callback invoked during long-running imports.
 *
 * @param imported - Number of records imported so far.
 * @param total - Total records expected for the job.
 */
export type ProgressCb = (imported: number, total: number) => void;

// ── Schema ──────────────────────────────────────────────────────────────────

export const ensureModImportSchema = async (db: Tx) => {
  await db.query('ALTER TABLE mod_imports ADD COLUMN IF NOT EXISTS nexus_mod_id INTEGER');
  await db.query('ALTER TABLE mod_imports ADD COLUMN IF NOT EXISTS source_folder TEXT');
  await db.query('ALTER TABLE mod_imports ADD COLUMN IF NOT EXISTS nexus_mod_name TEXT');
};

// ── CRUD helpers ────────────────────────────────────────────────────────────

/**
 * List all mod import jobs ordered by newest first.
 */
export const listModImportJobs = async (db: Tx): Promise<ModImportJob[]> => {
  const { rows } = await db.query('SELECT * FROM mod_imports ORDER BY created_at DESC');
  return rows as ModImportJob[];
};

/**
 * Fetch a single import job by id.
 */
export const getModImportJob = async (db: Tx, id: number): Promise<ModImportJob | undefined> => {
  const { rows } = await db.query('SELECT * FROM mod_imports WHERE id = $1', [id]);
  return rows[0] as ModImportJob | undefined;
};

/**
 * Update the language settings stored on an import job.
 *
 * These values influence locale selection and later translation defaults.
 */
export const updateModJobLanguages = async (
  db: Tx,
  id: number,
  srcLang: string,
  tgtLang: string,
) => {
  await db.query(
    `UPDATE mod_imports
     SET src_lang = $1,
         tgt_lang = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [srcLang, tgtLang, id],
  );
};

/**
 * Resets a finished/failed/paused mod import job back to pending so it can be
 * started again from the beginning.
 */
export const restartModImportJob = async (db: Tx, id: number) => {
  await db.query(
    `UPDATE mod_imports
     SET status = 'pending', imported_records = 0, updated_at = NOW()
     WHERE id = $1`,
    [id],
  );
};

/**
 * Delete an import job row.
 *
 * Note: this does not delete any ingested strings/records for the associated
 * mod; it only removes the job tracker.
 */
export const deleteModImportJob = async (db: Tx, id: number) => {
  await db.query('DELETE FROM mod_imports WHERE id = $1', [id]);
};

/**
 * Derive a stable mod display name from the uploaded file name.
 *
 * The same rule is used for direct plugin uploads and archive uploads so the
 * later DB ingestion step produces the same mod name as the previous eager
 * registration flow.
 */
const deriveModNameFromFileName = (fileName: string): string => {
  return fileName.replace(/\.(esp|esm|esl|zip|7z|rar)$/i, '');
};

/**
 * Resolve common UI language codes to Bethesda locale file names.
 *
 * The importer UI uses short codes such as `ru`, while localized plugin and
 * MCM assets on disk usually use names such as `russian`. This helper accepts
 * either form and returns the actual locale key present in the import job.
 */
const resolveAvailableLocale = <T>(
  locales: Map<string, T>,
  requestedLang: string,
): { resolvedKey: string; value: T } | null => {
  const requested = requestedLang.trim().toLowerCase();
  if (!requested) return null;

  const aliases = MCM_LOCALE_ALIASES;

  const candidates = aliases.get(requested) ?? [requested];
  for (const candidate of candidates) {
    const value = locales.get(candidate);
    if (value !== undefined) {
      return { resolvedKey: candidate, value };
    }
  }

  for (const [localeKey, aliasList] of aliases) {
    if (!aliasList.includes(requested)) continue;
    const value = locales.get(localeKey);
    if (value !== undefined) {
      return { resolvedKey: localeKey, value };
    }
  }

  return null;
};

/** Default source language when a mod has no external locale files. */
export const MOD_IMPORT_DEFAULT_SOURCE_LOCALE = 'en';

/** True when the job should ingest every locale present in the mod. */
export const isImportAllLocalesRequest = (srcLang: string): boolean => {
  const normalized = srcLang.trim().toLowerCase();
  return normalized === '' || normalized === 'en' || normalized === 'english';
};

/** Normalize a locale code via {@link MCM_LOCALE_ALIASES} for equality checks. */
const normalizeLocaleAlias = (lang: string): string => {
  const lower = lang.trim().toLowerCase();
  if (!lower) return lower;

  for (const [key, aliases] of MCM_LOCALE_ALIASES) {
    if (key === lower || aliases.includes(lower)) return key;
  }

  return lower;
};

export type ModImportLocaleInfo = {
  jobId: number;
  modId: number | null;
  currentSrcLang: string;
  storedLangs: string[];
  availableLocales: string[];
  isLocalized: boolean;
  stringCount: number;
};

export type ChangeModImportLocaleResult = {
  modId: number;
  jobId: number;
  oldLang: string;
  newLang: string;
  stringsUpdated: number;
  translationsUpdated: number;
};

/** Locale metadata for an import job — stored DB langs plus on-disk locales when available. */
export const getModImportLocaleInfo = async (
  db: Tx,
  jobId: number,
): Promise<ModImportLocaleInfo> => {
  const job = await getModImportJob(db, jobId);
  if (!job) throw new Error('Import job not found');

  let availableLocales: string[] = [];
  if (job.esp_path && fs.existsSync(job.esp_path)) {
    try {
      availableLocales = previewModRecords(job).locales;
    } catch {
      /* uploaded files may be missing or unreadable */
    }
  }

  let storedLangs: string[] = [];
  let stringCount = 0;
  if (job.mod_id != null) {
    const { rows } = await db.query<{ lang: string; cnt: string }>(
      `SELECT s.lang, COUNT(*)::text AS cnt
       FROM strings s
       JOIN records r ON r.id = s.record_id
       WHERE r.mod_id = $1 AND s.lang IS NOT NULL
       GROUP BY s.lang
       ORDER BY COUNT(*) DESC`,
      [job.mod_id],
    );
    storedLangs = rows.map((row) => row.lang);
    stringCount = rows.reduce((sum, row) => sum + Number.parseInt(row.cnt, 10), 0);
  }

  return {
    jobId,
    modId: job.mod_id,
    currentSrcLang: job.src_lang,
    storedLangs,
    availableLocales,
    isLocalized: job.is_localized === 1,
    stringCount,
  };
};

/**
 * Change the source locale tag for a completed import without re-reading files.
 *
 * Updates `mod_imports.src_lang`, matching `strings.lang` rows, and import-time
 * self-translations (`provenance = import_self_translation`) for the mod.
 */
export const changeModImportLocaleInDb = async (
  db: Tx,
  jobId: number,
  newSrcLang: string,
): Promise<ChangeModImportLocaleResult> => {
  const job = await getModImportJob(db, jobId);
  if (!job) throw new Error('Import job not found');
  if (isModImportRunning(jobId)) throw new Error('Cannot change locale while import is running');
  if (job.status !== 'completed')
    throw new Error('Locale can only be changed on completed imports');
  if (job.mod_id == null) throw new Error('Import has no associated mod');

  const newLang = newSrcLang.trim();
  if (!newLang) throw new Error('Locale is required');

  const { rows: langRows } = await db.query<{ lang: string }>(
    `SELECT DISTINCT s.lang
     FROM strings s
     JOIN records r ON r.id = s.record_id
     WHERE r.mod_id = $1 AND s.lang IS NOT NULL`,
    [job.mod_id],
  );
  const storedLangs = langRows.map((row) => row.lang);
  if (storedLangs.length === 0) {
    throw new Error('Mod has no imported strings to relabel');
  }

  const storedLookup = new Map(storedLangs.map((lang) => [lang, true]));
  const oldLangResolved =
    resolveAvailableLocale(storedLookup, job.src_lang)?.resolvedKey ??
    (storedLangs.length === 1 ? storedLangs[0]! : storedLangs[0]!);

  if (normalizeLocaleAlias(oldLangResolved) === normalizeLocaleAlias(newLang)) {
    throw new Error('New locale is the same as the current locale');
  }

  await db.query('BEGIN');
  try {
    const stringsResult = await db.query(
      `UPDATE strings s
       SET lang = $1
       FROM records r
       WHERE s.record_id = r.id
         AND r.mod_id = $2
         AND s.lang = $3`,
      [newLang, job.mod_id, oldLangResolved],
    );

    const translationsResult = await db.query(
      `UPDATE translations t
       SET target_lang = $1
       FROM strings s
       JOIN records r ON r.id = s.record_id
       WHERE t.src_string_id = s.id
         AND r.mod_id = $2
         AND t.target_lang = $3
         AND t.provenance = 'import_self_translation'`,
      [newLang, job.mod_id, oldLangResolved],
    );

    await updateModJobLanguages(db, jobId, newLang, job.tgt_lang);
    await db.query('COMMIT');

    return {
      modId: job.mod_id,
      jobId,
      oldLang: oldLangResolved,
      newLang,
      stringsUpdated: stringsResult.rowCount ?? 0,
      translationsUpdated: translationsResult.rowCount ?? 0,
    };
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
};

/**
 * Ensure the requested import locale exists on disk for this job.
 *
 * Non-localized plugins accept any language tag. Localized plugins require a
 * matching STRINGS locale unless "import all localizations" is selected.
 */
export const validateModImportLocaleSelection = (
  job: ModImportJob,
  srcLang: string,
  importAllLocalizations: boolean,
): void => {
  const anchorPath = job.esp_path;
  if (!anchorPath || !fs.existsSync(anchorPath)) {
    throw new Error('Import file not found on disk');
  }

  if (!isPluginPath(anchorPath)) {
    if (importAllLocalizations) return;

    const modDir = resolveModDirectoryFromPath(anchorPath);
    const mcmLocales = collectMcmLocalesForMod(modDir, anchorPath);
    if (mcmLocales.size === 0) return;

    if (!resolveAvailableLocale(mcmLocales, srcLang)) {
      const available = [...mcmLocales.keys()].sort().join(', ');
      throw new Error(`Locale "${srcLang}" not found. Available locales: ${available}`);
    }
    return;
  }

  const game: GameType = (job.game as GameType) ?? 'fo4';
  const esp = new EspReader(anchorPath, game);
  if (!esp.info.isLocalized) return;

  const localeSources = discoverLocaleSources(
    anchorPath,
    game,
    discoverArchiveCandidatesForPlugin(anchorPath),
  );
  if (localeSources.length === 0 || importAllLocalizations) return;

  const localeKeys = new Map(localeSources.map((s) => [s.locale, true]));
  if (!resolveSingleImportLocale(localeKeys, srcLang)) {
    const available = localeSources
      .map((s) => s.locale)
      .sort()
      .join(', ');
    throw new Error(`Locale "${srcLang}" not found in mod files. Available locales: ${available}`);
  }
};

/**
 * Resolve a single-locale import target, or null to import all available locales.
 */
const resolveSingleImportLocale = (
  locales: Map<string, unknown>,
  srcLang: string,
): string | null => {
  if (isImportAllLocalesRequest(srcLang)) return null;
  return resolveAvailableLocale(locales, srcLang)?.resolvedKey ?? null;
};

/** Language tag used for non-localized plugin strings and PEX literals. */
const resolveModStringsLang = (requestedLang: string | null | undefined): string => {
  const trimmed = requestedLang?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : MOD_IMPORT_DEFAULT_SOURCE_LOCALE;
};

/**
 * Find BA2/BSA archives that may contain STRINGS for a plugin.
 * Searches the plugin directory first, then its parent (common archive layouts).
 */
const discoverArchiveCandidatesForPlugin = (espPath: string): string[] => {
  const pluginDir = path.dirname(espPath);
  const fromPluginDir = discoverModFiles(pluginDir);
  const candidates = [...fromPluginDir.ba2s, ...fromPluginDir.bsas];
  if (candidates.length > 0) return candidates;

  const parentDir = path.dirname(pluginDir);
  if (parentDir === pluginDir) return candidates;

  const fromParent = discoverModFiles(parentDir);
  return [...fromParent.ba2s, ...fromParent.bsas];
};

/**
 * Pick the best locale map for English NPC-name resolution during import.
 */
const resolveEnglishLocaleMap = (
  localeSources: ReturnType<typeof discoverLocaleSources>,
): Map<number, string> | undefined => {
  const source = resolveEnglishLocaleSource(localeSources);
  return source ? loadLocaleStrings(source) : undefined;
};

const materializeImportCsvRows = (
  espRows: EspStringRow[],
  stringsMap: Map<number, string> | null,
): CsvRow[] => [...generateImportCsvRows(espRows, stringsMap)];

/**
 * Convert generic CSV-style rows into the canonical imported-row shape used by
 * the translation-apply matcher.
 */
const toApplyRows = (rows: CsvRow[]): ModImportApplyRow[] =>
  rows.map((row) => ({
    formid_hex: row.FormID ?? '',
    path: row.Path,
    path_simplified: row.PathSimplified ?? row.Path.replace(/\[\d+\]/g, ''),
    signature: row.Signature ?? null,
    edid: row.EDID ?? null,
    text_raw: row.Source,
  }));

/**
 * Extract translatable rows directly from an import job on disk.
 *
 * This is the non-ingesting counterpart to {@link runModImport}. It reads the
 * plugin, optional STRINGS locales, optional MCM translations, and optional
 * PEX literals, then returns the same logical row data that would otherwise be
 * loaded from `records + strings` after a full import.
 *
 * @param job - Existing import job.
 * @param importedLang - Language selected by the user for the translation mod.
 */
export const extractModImportApplyRows = (
  job: ModImportJob,
  importedLang: string,
): ModImportApplyRow[] => {
  const anchorPath = job.esp_path;
  if (!anchorPath || !fs.existsSync(anchorPath)) {
    throw new Error('Import file not found on disk');
  }

  const modDir = resolveModDirectoryFromPath(anchorPath);
  const collected: CsvRow[] = [];

  if (isPluginPath(anchorPath)) {
    const game: GameType = (job.game as GameType) ?? 'fo4';
    const esp = new EspReader(anchorPath, game);
    const espRows = esp.extractStrings();

    if (esp.info.isLocalized) {
      const localeSources = discoverLocaleSources(
        anchorPath,
        game,
        discoverArchiveCandidatesForPlugin(anchorPath),
      );
      const byLocale = localeSourcesByLocale(localeSources);
      const resolved = resolveAvailableLocale(byLocale, importedLang);
      if (!resolved) {
        const available = localeSources
          .map((s) => s.locale)
          .sort()
          .join(', ');
        throw new Error(
          available
            ? `Localized import does not contain locale "${importedLang}". Available locales: ${available}`
            : 'Localized import does not contain any STRINGS locales',
        );
      }
      collected.push(...materializeImportCsvRows(espRows, loadLocaleStrings(resolved.value)));
    } else {
      collected.push(...materializeImportCsvRows(espRows, null));
    }

    const pexMap = collectPexStringsSync(anchorPath, (job.game as GameType) ?? 'fo4');
    if (pexMap.size > 0) {
      collected.push(...buildPexCsvRows(pexMap, new Map()).map((row) => row.csvRow));
    }
  }

  const mcmLocales = collectMcmLocalesForMod(modDir, anchorPath);
  const resolvedMcm =
    resolveMcmLocaleKey(mcmLocales, importedLang) ??
    (isPluginPath(anchorPath)
      ? resolveMcmLocaleKey(mcmLocales, MOD_IMPORT_DEFAULT_SOURCE_LOCALE)
      : null);
  if (resolvedMcm) {
    collected.push(...buildMcmCsvRows(resolvedMcm.value));
  } else if (!isPluginPath(anchorPath)) {
    const available = [...mcmLocales.keys()].sort().join(', ');
    throw new Error(
      available
        ? `MCM translation patch does not contain locale "${importedLang}". Available locales: ${available}`
        : 'MCM translation patch does not contain any translation files',
    );
  }

  if (collected.length === 0) {
    throw new Error(`Import job has no translatable rows for lang "${importedLang}"`);
  }

  return toApplyRows(collected);
};

// ── Archive extraction ──────────────────────────────────────────────────────

const ARCHIVE_EXTS = new Set(['.zip', '.7z', '.rar']);
const PLUGIN_EXTS = new Set(['.esp', '.esm', '.esl']);

/**
 * Return true if the file name looks like a supported archive type.
 */
export const isArchive = (fileName: string): boolean => {
  return ARCHIVE_EXTS.has(path.extname(fileName).toLowerCase());
};

/**
 * Return true if the file name looks like a supported plugin type.
 */
export const isPlugin = (fileName: string): boolean => {
  return PLUGIN_EXTS.has(path.extname(fileName).toLowerCase());
};

/** True when the path points to an ESP/ESM/ESL file (not a directory). */
const isPluginPath = (filePath: string): boolean => {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) return false;
  } catch {
    // Fall through to extension check.
  }
  return isPlugin(path.basename(filePath));
};

/**
 * Extracts a ZIP or 7z archive using the bundled 7za binary.
 */
const extract7z = (archivePath: string, outDir: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const stream = Seven.extractFull(archivePath, outDir, {
      $bin: path7za,
      yes: true,
      recursive: true,
    });
    stream.on('end', () => resolve());
    stream.on('error', (err: Error) => reject(err));
  });
};

/**
 * Extracts a RAR archive using the system `unrar` binary (RARLAB freeware).
 *
 * `unrar` must be installed separately:
 *  - Docker/Linux: `apt-get install unrar` (non-free repo, supports RAR5)
 *  - Windows (dev): install WinRAR or the standalone unrar.exe and ensure it's on PATH
 *
 * Throws a clear error if `unrar` is not found so the caller can surface a
 * useful message to the user instead of a cryptic ENOENT.
 */
const extractRar = (archivePath: string, outDir: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    // `x` = extract with full paths; `-y` = assume yes; `-o+` = overwrite
    execFile(
      'unrar',
      ['x', '-y', '-o+', archivePath, `${outDir}${path.sep}`],
      (err, _stdout, stderr) => {
        if (!err) return resolve();

        // Provide a helpful message when unrar is not installed
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return reject(
            new Error(
              'RAR extraction requires "unrar" to be installed. ' +
                'On Linux/Docker: apt-get install unrar. ' +
                'On Windows (dev): install WinRAR or standalone unrar.exe and add to PATH.',
            ),
          );
        }

        reject(new Error(`unrar failed: ${stderr || err.message}`));
      },
    );
  });
};

/**
 * Extracts a ZIP, 7z, or RAR archive to the given directory.
 * Dispatches to the appropriate backend based on file extension.
 */
/**
 * Extract an archive into a destination directory.
 *
 * Uses:
 * - bundled `7za` for `.zip` and `.7z`,
 * - and system `unrar` for `.rar` (must be installed separately).
 *
 * @param archivePath - Absolute path to the archive.
 * @param outDir - Destination directory (must exist).
 */
export const extractArchive = (archivePath: string, outDir: string): Promise<void> => {
  const ext = path.extname(archivePath).toLowerCase();
  if (ext === '.rar') return extractRar(archivePath, outDir);
  return extract7z(archivePath, outDir);
};

/**
 * Discover ESP/ESL/ESM + BA2 (FO4) and BSA (SSE) files inside a directory (recursive).
 */
/**
 * Recursively discover mod files within a directory.
 *
 * This is used after archive extraction to locate the primary plugin and any
 * adjacent BA2/BSA companion archives.
 *
 * @param dir - Directory to walk recursively.
 * @returns Lists of discovered plugins, BA2 archives, and BSA archives.
 */
export const discoverModFiles = (
  dir: string,
): { plugins: string[]; ba2s: string[]; bsas: string[] } => {
  const plugins: string[] = [];
  const ba2s: string[] = [];
  const bsas: string[] = [];

  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (PLUGIN_EXTS.has(ext)) plugins.push(full);
      else if (ext === '.ba2') ba2s.push(full);
      else if (ext === '.bsa') bsas.push(full);
    }
  };
  walk(dir);
  return { plugins, ba2s, bsas };
};

/** Directory names skipped during recursive mod discovery. */
const MOD_SCAN_SKIP_DIRS = new Set(['.transynth-extracted', '.git', 'node_modules']);

/** A mod artifact discovered in a directory listing. */
export interface ModFileCandidate {
  fileName: string;
  filePath: string;
  kind: 'plugin' | 'archive';
  /** Vortex staging folder metadata when scanning a Vortex mod tree. */
  vortex?: VortexFolderInfo;
}

/**
 * List supported mod files in a directory, optionally including subfolders.
 *
 * Used by batch scans of mod install trees where plugins and archives may sit
 * in nested folders (e.g. per-mod subdirectories under a staging directory).
 */
export const listModFilesInDirectory = (
  dir: string,
  recursive = true,
  scanRoot = dir,
): ModFileCandidate[] => {
  const candidates: ModFileCandidate[] = [];

  const walk = (currentDir: string) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !MOD_SCAN_SKIP_DIRS.has(entry.name)) walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const fileName = entry.name;
      const vortex = resolveVortexFolderFromPath(fullPath, scanRoot) ?? undefined;
      if (isPlugin(fileName)) {
        candidates.push({ fileName, filePath: fullPath, kind: 'plugin', vortex });
      } else if (isArchive(fileName)) {
        candidates.push({ fileName, filePath: fullPath, kind: 'archive', vortex });
      }
    }
  };

  walk(dir);

  candidates.sort((a, b) =>
    a.filePath.localeCompare(b.filePath, undefined, { sensitivity: 'base' }),
  );
  return candidates;
};

/**
 * Locate the BA2 archive that holds STRINGS/DLSTRINGS/ILSTRINGS for a plugin.
 *
 * FO4/FO76 vanilla base game packs strings in `{Plugin} - Interface.ba2`, not
 * `{Plugin} - Main.ba2`. DLC and most mods use `{Plugin} - Main.ba2` instead.
 */
const discoverBa2 = (
  modPath: string,
  ba2Candidates: string[],
  game: GameType = 'fo4',
): string | null => {
  const stem = path.basename(modPath, path.extname(modPath)).toLowerCase();
  const baseStem = path.basename(modPath, path.extname(modPath));
  const suffixes =
    game === 'fo4' || game === 'fo76' ? [' - main', ' - interface', ''] : [' - main', ''];

  for (const suffix of suffixes) {
    const target = suffix ? `${stem}${suffix}` : stem;
    for (const ba2 of ba2Candidates) {
      if (path.basename(ba2, '.ba2').toLowerCase() === target) return ba2;
    }
  }

  const dir = path.dirname(modPath);
  for (const suffix of suffixes) {
    const candidate = suffix ? `${baseStem}${suffix}.ba2` : `${baseStem}.ba2`;
    const p = path.join(dir, candidate);
    if (fs.existsSync(p)) return p;
  }
  return null;
};

/** List GNRL-type BA2 archives in a mod directory (skips DX10 texture archives). */
const listGnrBa2FilesInDir = (modDir: string): string[] => {
  try {
    return fs
      .readdirSync(modDir)
      .filter((f) => f.toLowerCase().endsWith('.ba2'))
      .map((f) => path.join(modDir, f))
      .filter(isBa2GnrArchive);
  } catch {
    return [];
  }
};

/**
 * GNRL BA2 archives that belong to one plugin — not every archive in a shared `Data\`
 * folder. Matches `{Stem} - Main.ba2`, `{Stem} - Interface.ba2`, and other stem-prefixed
 * companions (same rules as STRINGS discovery).
 */
const listCompanionGnrlBa2ForPlugin = (
  espPath: string,
  game: GameType,
  ba2Candidates: string[] = discoverArchiveCandidatesForPlugin(espPath),
): string[] => {
  const modDir = path.dirname(espPath);
  const stem = path.basename(espPath, path.extname(espPath)).toLowerCase();
  const ba2Cands = ba2Candidates.filter(
    (f) => f.toLowerCase().endsWith('.ba2') && isBa2GnrArchive(f),
  );
  const matched = new Set<string>();

  const primary = discoverBa2(espPath, ba2Cands, game);
  if (primary) matched.add(primary);

  for (const ba2 of ba2Cands) {
    const base = path.basename(ba2, '.ba2').toLowerCase();
    if (base.startsWith(stem)) matched.add(ba2);
  }

  for (const ba2 of listGnrBa2FilesInDir(modDir)) {
    const base = path.basename(ba2, '.ba2').toLowerCase();
    if (base.startsWith(stem)) matched.add(ba2);
  }

  return [...matched];
};

/**
 * Load all MCM translation files from a BA2 archive for one mod prefix list.
 *
 * @param ba2Path - Absolute path to the BA2 archive
 * @param modPrefixes - MCM file stems / modName prefixes to match
 */
const loadMcmLocalesFromBA2 = (
  ba2Path: string,
  modPrefixes: string[],
): Map<string, Map<string, string>> => {
  const reader = getBa2Reader(ba2Path);
  const locales = new Map<string, Map<string, string>>();

  const txtEntries = reader.listByExt('txt').filter((e) => isMcmTranslationArchivePath(e.name));

  for (const entry of txtEntries) {
    const baseName = path.basename(entry.name);
    if (!mcmTranslationMatchesMod(baseName, modPrefixes)) continue;

    const locale = mcmLocaleFromPath(entry.name);
    if (!locale) continue;

    const buf = reader.extractEntry(entry);
    const mcmMap = parseMcmBuffer(buf);
    if (mcmMap.size === 0) continue;

    if (!locales.has(locale)) locales.set(locale, new Map());
    const existing = locales.get(locale)!;
    for (const [k, v] of mcmMap) existing.set(k, v);
  }

  return locales;
};

/**
 * Load MCM translation files from loose files on disk.
 *
 * @param modDir - Directory containing the mod files
 * @param modPrefix - MCM modName prefix from config.json or plugin stem
 */
const loadMcmLocalesFromLooseFiles = (
  modDir: string,
  modPrefixes: string[],
): Map<string, Map<string, string>> => {
  const locales = new Map<string, Map<string, string>>();

  for (const dir of listMcmTranslationDirs(modDir)) {
    for (const file of fs.readdirSync(dir)) {
      if (!mcmTranslationMatchesMod(file, modPrefixes)) continue;

      const locale = mcmLocaleFromPath(file);
      if (!locale) continue;

      const buf = fs.readFileSync(path.join(dir, file));
      const mcmMap = parseMcmBuffer(buf);
      if (mcmMap.size === 0) continue;

      if (!locales.has(locale)) locales.set(locale, new Map());
      const existing = locales.get(locale)!;
      for (const [k, v] of mcmMap) existing.set(k, v);
    }
  }

  return locales;
};

/**
 * Collect all MCM locales for a mod folder by scanning GNRL BA2 archives and loose
 * translation txt files that match the mod's MCM prefix.
 */
const collectMcmLocalesForMod = (
  modDir: string,
  anchorPath: string,
  game: GameType = 'fo4',
): Map<string, Map<string, string>> => {
  const modPrefix = resolveMcmModPrefix(modDir, anchorPath);
  const modPrefixes = resolveMcmTranslationPrefixes(modDir, modPrefix);
  const merged = new Map<string, Map<string, string>>();

  for (const ba2Path of listCompanionGnrlBa2ForPlugin(anchorPath, game)) {
    try {
      for (const [locale, mcmMap] of loadMcmLocalesFromBA2(ba2Path, modPrefixes)) {
        if (!merged.has(locale)) merged.set(locale, new Map());
        for (const [k, v] of mcmMap) merged.get(locale)!.set(k, v);
      }
    } catch (err) {
      logImport.warn(
        `MCM: could not read BA2 "${path.basename(ba2Path)}": ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  for (const [locale, mcmMap] of loadMcmLocalesFromLooseFiles(modDir, modPrefixes)) {
    if (!merged.has(locale)) merged.set(locale, new Map());
    for (const [k, v] of mcmMap) merged.get(locale)!.set(k, v);
  }

  for (const [locale, mcmMap] of loadMcmLocalesFromConfigJson(modDir, modPrefixes)) {
    if (!merged.has(locale)) merged.set(locale, new Map());
    const bucket = merged.get(locale)!;
    for (const [k, v] of mcmMap) {
      if (!bucket.has(k)) bucket.set(k, v);
    }
  }

  return merged;
};

/** Parallel BA2 scan — used during long-running import only. */
const collectMcmLocalesForModParallel = async (
  modDir: string,
  anchorPath: string,
  game: GameType = 'fo4',
): Promise<Map<string, Map<string, string>>> => {
  const modPrefix = resolveMcmModPrefix(modDir, anchorPath);
  const modPrefixes = resolveMcmTranslationPrefixes(modDir, modPrefix);
  const merged = new Map<string, Map<string, string>>();

  const ba2Paths = listCompanionGnrlBa2ForPlugin(anchorPath, game);
  const ba2LocaleMaps = await mapWithConcurrency(
    ba2Paths,
    CONFIG.modImportIoParallel,
    async (ba2Path) => {
      try {
        return loadMcmLocalesFromBA2(ba2Path, modPrefixes);
      } catch (err) {
        logImport.warn(
          `MCM: could not read BA2 "${path.basename(ba2Path)}": ${err instanceof Error ? err.message : err}`,
        );
        return new Map<string, Map<string, string>>();
      }
    },
  );

  for (const mcmLocales of ba2LocaleMaps) {
    for (const [locale, mcmMap] of mcmLocales) {
      if (!merged.has(locale)) merged.set(locale, new Map());
      for (const [k, v] of mcmMap) merged.get(locale)!.set(k, v);
    }
  }

  for (const [locale, mcmMap] of loadMcmLocalesFromLooseFiles(modDir, modPrefixes)) {
    if (!merged.has(locale)) merged.set(locale, new Map());
    for (const [k, v] of mcmMap) merged.get(locale)!.set(k, v);
  }

  for (const [locale, mcmMap] of loadMcmLocalesFromConfigJson(modDir, modPrefixes)) {
    if (!merged.has(locale)) merged.set(locale, new Map());
    const bucket = merged.get(locale)!;
    for (const [k, v] of mcmMap) {
      if (!bucket.has(k)) bucket.set(k, v);
    }
  }

  return merged;
};

/**
 * Collect all MCM locales for a plugin by scanning GNRL BA2 archives and loose
 * `Interface/Translations` files that match the mod's MCM prefix.
 *
 * @param espPath - Absolute path to the plugin (.esp/.esm/.esl)
 */
const collectMcmLocales = (espPath: string): Map<string, Map<string, string>> => {
  const modDir = resolveModDirectoryFromPath(espPath);
  return collectMcmLocalesForMod(modDir, espPath);
};

const countMcmTranslationRecords = (modDir: string, anchorPath: string): number => {
  const locales = collectMcmLocalesForMod(modDir, anchorPath);
  let max = 0;
  for (const mcmMap of locales.values()) max = Math.max(max, mcmMap.size);
  return max;
};

/**
 * Build a FormID → NPC display-name map from extracted ESP rows.
 *
 * Looks at all NPC_ FULL subrecord rows. For non-localized plugins the text
 * field is already the display name. For localized plugins the text field is
 * an lstring ID that is resolved via the supplied stringsMap.
 *
 * @param espRows - Rows returned by EspReader.extractStrings().
 * @param strMap  - Optional lstring ID → text map (source locale), used for localized plugins.
 */
const buildNpcNameMap = (
  espRows: EspStringRow[],
  strMap?: Map<number, string> | null,
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const row of espRows) {
    if (row.signature !== 'NPC_' || row.path !== 'FULL') continue;
    if (row.isLstringId) {
      if (!strMap) continue;
      const id = parseInt(row.text, 10);
      const name = strMap.get(id);
      if (name) map.set(row.formId, name);
    } else {
      map.set(row.formId, row.text);
    }
  }
  return map;
};

/**
 * Build a map from INFO record FormID → speaker NPC FormID.
 *
 * Iterates espRows and collects the speakerFormId value that EspReader
 * populates from the ANAM subrecord of each INFO record.
 *
 * @param espRows - Rows returned by EspReader.extractStrings().
 */
const buildSpeakerFormIdMap = (espRows: EspStringRow[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const row of espRows) {
    if (row.speakerFormId) map.set(row.formId, row.speakerFormId);
  }
  return map;
};

/**
 * Clean a voice directory name into a human-readable speaker label.
 *
 * Typical folder names follow `<ModPrefix>_<Name>Voice` or `NPC[FM]<Name>`.
 * The function strips known prefixes/suffixes and inserts spaces at
 * CamelCase boundaries.
 */
const cleanVoiceFolderName = (name: string): string => {
  let cleaned = name.replace(/Voice$/i, '');
  // Strip NPC gender prefix (NPCFPiper → Piper)
  cleaned = cleaned.replace(/^NPC[FM]/i, '');
  // If underscore remains, take the part after the last one (e.g. DP_Stella → Stella)
  if (cleaned.includes('_')) {
    cleaned = cleaned.substring(cleaned.lastIndexOf('_') + 1);
  }
  // Insert spaces before CamelCase boundaries (TinaDeLuca → Tina De Luca)
  cleaned = cleaned.replace(/([a-z])([A-Z])/g, '$1 $2');
  // Insert spaces before digit runs (Male01 → Male 01)
  cleaned = cleaned.replace(/([a-zA-Z])(\d)/g, '$1 $2');
  if (/^Player Voice (Female|Male) \d+$/i.test(cleaned.trim())) {
    return 'Player';
  }
  return cleaned || name;
};

/**
 * Build a speaker-name lookup from voice file directories.
 *
 * FO4 voice files live at `Sound/Voice/<Plugin>/<SpeakerFolder>/<FormID>_<N>.fuz`.
 * Most quest-based INFO records lack an ANAM subrecord (speaker is determined
 * by quest aliases), so voice file paths are the most reliable fallback for
 * identifying the speaker.
 *
 * The returned map keys are the **lower 6 hex digits** of the INFO FormID
 * (stripping the 2-char load-order prefix) because CK exports voice files
 * with a hard-coded `00` prefix regardless of the plugin's actual load index.
 *
 * @param espPath - Absolute path to the plugin file.
 * @returns Map from lower-6-hex FormID → cleaned speaker display name.
 */
const buildVoiceSpeakerMap = (espPath: string): Map<string, string> => {
  const map = new Map<string, string>();
  const modDir = path.dirname(espPath);
  const pluginName = path.basename(espPath);
  const voiceRoot = path.join(modDir, 'Sound', 'Voice', pluginName);

  if (!fs.existsSync(voiceRoot)) return map;

  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(voiceRoot, { withFileTypes: true });
  } catch {
    return map;
  }

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const speakerName = cleanVoiceFolderName(dir.name);

    let files: string[];
    try {
      files = fs.readdirSync(path.join(voiceRoot, dir.name));
    } catch {
      continue;
    }

    for (const file of files) {
      const match = file.match(/^([0-9A-Fa-f]{8})_\d+\.(fuz|wav|xwm)$/i);
      if (!match) continue;
      // Strip the 2-char load-order prefix → lower 6 hex digits as key
      const lower6 = match[1].substring(2).toUpperCase();
      if (!map.has(lower6)) {
        map.set(lower6, speakerName);
      }
    }
  }

  logImport.debug(`Voice speaker map: ${map.size} entries from ${voiceRoot}`);
  return map;
};

/**
 * Convert an MCM locale's key→text map into generic CsvRow objects.
 *
 * Each MCM key becomes:
 *   FormID   : ''            (MCM strings have no record FormID)
 *   Signature: 'MCM'         (distinguishing signature in the records table)
 *   Path     : 'MCM\\$key'   (the MCM token as the path, e.g. MCM\\$OptionLabel)
 *   Source   : translated text
 *
 * @param mcmMap - Map of MCM $key → text string for a single locale
 */
const buildMcmCsvRows = (mcmMap: Map<string, string>): CsvRow[] =>
  Array.from(mcmMap.entries()).map(([key, text]) => ({
    FormID: '',
    Signature: 'MCM',
    Path: `MCM\\${key}`,
    PathSimplified: `MCM\\${key}`,
    Source: text,
  }));
// ── PEX (Papyrus compiled script) helpers ────────────────────────────────────

type PexScriptStrings = {
  sourceFile: string;
  pexFile: string | null;
  data: Buffer;
  literals: Array<{
    text: string;
    literalIndex: number;
    usages: PexStringUsage[];
  }>;
};

type PexImportRow = {
  csvRow: CsvRow;
  context: string;
};

const pexBundleFromParse = (
  parsed: ReturnType<typeof parsePexBuffer>,
  pexFile: string | null,
  data: Buffer,
): PexScriptStrings => ({
  sourceFile: parsed.info.sourceFile,
  pexFile,
  data,
  literals: parsed.userStrings.map((entry) => ({
    text: entry.text,
    literalIndex: entry.literalIndex,
    usages: entry.usages,
  })),
});

/**
 * Extract translatable strings from all .pex script files inside a BA2 archive.
 *
 * @param ba2Path - Absolute path to the BA2 archive
 */
const loadPexStringsFromBA2 = (ba2Path: string): Map<string, PexScriptStrings> => {
  const reader = getBa2Reader(ba2Path);
  const result = new Map<string, PexScriptStrings>();

  for (const entry of reader.listByExt('pex')) {
    try {
      const buf = reader.extractEntry(entry);
      const parsed = parsePexBuffer(buf);
      if (parsed.strings.length === 0) continue;
      const scriptKey = pexScriptKeyFromInfo(parsed.info) || entry.name.replace(/\.pex$/i, '');
      result.set(scriptKey, pexBundleFromParse(parsed, entry.name, buf));
    } catch (err) {
      logImport.debug(`PEX: skipping "${entry.name}": ${err instanceof Error ? err.message : err}`);
    }
  }

  return result;
};

/**
 * Extract translatable strings from loose .pex files found under
 * `<modDir>/Scripts/` on disk.
 *
 * @param modDir - Directory containing the mod files (parent of the .esp)
 */
const loadPexStringsFromLooseFiles = (modDir: string): Map<string, PexScriptStrings> => {
  const scriptsDir = path.join(modDir, 'Scripts');
  const result = new Map<string, PexScriptStrings>();
  if (!fs.existsSync(scriptsDir)) return result;

  let files: string[];
  try {
    files = fs.readdirSync(scriptsDir).filter((f) => f.toLowerCase().endsWith('.pex'));
  } catch {
    return result;
  }

  for (const file of files) {
    try {
      const buf = fs.readFileSync(path.join(scriptsDir, file));
      const parsed = parsePexBuffer(buf);
      if (parsed.strings.length === 0) continue;
      const scriptKey = pexScriptKeyFromInfo(parsed.info) || file.replace(/\.pex$/i, '');
      result.set(scriptKey, pexBundleFromParse(parsed, file, buf));
    } catch (err) {
      logImport.debug(
        `PEX: skipping loose file "${file}": ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return result;
};

/**
 * Collect all PEX translatable strings for a plugin by scanning companion BA2
 * archives and any loose `Scripts/*.pex` files next to the plugin.
 *
 * Merges results so that a script appearing in both a BA2 and loose files
 * prefers the loose file (which may be a patched version).
 *
 * @param espPath - Absolute path to the plugin (.esp/.esm/.esl)
 */
const collectPexStringsSync = (
  espPath: string,
  game: GameType = 'fo4',
): Map<string, PexScriptStrings> => {
  const modDir = path.dirname(espPath);
  const merged = new Map<string, PexScriptStrings>();

  for (const ba2Path of listCompanionGnrlBa2ForPlugin(espPath, game)) {
    try {
      for (const [script, bundle] of loadPexStringsFromBA2(ba2Path)) {
        if (!merged.has(script)) merged.set(script, bundle);
      }
    } catch (err) {
      logImport.warn(
        `PEX: could not read BA2 "${path.basename(ba2Path)}": ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  for (const [script, bundle] of loadPexStringsFromLooseFiles(modDir)) {
    merged.set(script, bundle);
  }

  return merged;
};

const collectPexStrings = async (
  espPath: string,
  game: GameType = 'fo4',
): Promise<Map<string, PexScriptStrings>> => {
  const modDir = path.dirname(espPath);
  const merged = new Map<string, PexScriptStrings>();

  const ba2Paths = listCompanionGnrlBa2ForPlugin(espPath, game);
  const ba2Results = await mapWithConcurrency(
    ba2Paths,
    CONFIG.modImportIoParallel,
    async (ba2Path) => {
      try {
        return loadPexStringsFromBA2(ba2Path);
      } catch (err) {
        logImport.warn(
          `PEX: could not read BA2 "${path.basename(ba2Path)}": ${err instanceof Error ? err.message : err}`,
        );
        return new Map<string, PexScriptStrings>();
      }
    },
  );

  for (const pexMap of ba2Results) {
    for (const [script, bundle] of pexMap) {
      if (!merged.has(script)) merged.set(script, bundle);
    }
  }

  for (const [script, bundle] of loadPexStringsFromLooseFiles(modDir)) {
    merged.set(script, bundle);
  }

  return merged;
};

/**
 * Convert collected PEX script literals into CsvRow objects for DB ingestion.
 *
 * Each unique string in a given script becomes one row:
 *   FormID    : ''              (PEX strings have no ESM FormID)
 *   Signature : 'PEX'           (distinguishes PEX rows in the editor)
 *   Path      : 'PEX\\<script>' (e.g. PEX\\CraftingScript)
 *   Source    : the string literal text
 *
 * `context` stores decompiled Papyrus source context (line + snippet) when Champollion
 * is available, otherwise falls back to script name and literal index.
 *
 * Duplicate strings within the same script are deduplicated here to avoid
 * inserting the same text twice (the PEX string table may repeat entries
 * that are referenced from multiple call sites).
 */
const buildPexCsvRows = (
  pexMap: Map<string, PexScriptStrings>,
  decompiled: Map<string, DecompiledPexScript>,
): PexImportRow[] => {
  const rows: PexImportRow[] = [];
  let skipped = 0;
  for (const [scriptName, bundle] of pexMap) {
    const recordPath = `PEX\\${scriptName}`;
    const seen = new Set<string>();
    const pscBundle = decompiled.get(scriptName);
    const candidates = new Map<
      string,
      { text: string; literalIndex: number; usages: PexStringUsage[] }
    >();

    for (const entry of bundle.literals) {
      candidates.set(entry.text, entry);
    }

    if (pscBundle) {
      for (const text of extractQuotedStringLiteralsFromPsc(pscBundle.pscSource)) {
        if (!candidates.has(text)) {
          candidates.set(text, { text, literalIndex: 0, usages: [] });
        }
      }
    }

    for (const { text, literalIndex, usages } of candidates.values()) {
      if (seen.has(text)) continue;
      if (!isPexLiteralTranslatable(text, usages, pscBundle?.pscSource)) {
        skipped++;
        continue;
      }
      seen.add(text);

      let context = formatPexStringContext(bundle.sourceFile, { literalIndex, usages });
      if (pscBundle) {
        const snippet = locatePexLiteralInPsc(pscBundle.pscSource, text, {
          scriptLabel: path.basename(pscBundle.headerSourceFile || `${scriptName}.psc`),
          headerSourceFile: pscBundle.headerSourceFile,
        });
        if (snippet) context = serializePexStoredContext(snippet);
      }

      rows.push({
        csvRow: {
          FormID: '',
          Signature: 'PEX',
          Path: recordPath,
          PathSimplified: recordPath,
          Source: text,
        },
        context,
      });
    }
  }
  if (skipped > 0) {
    logImport.debug(`PEX filter: skipped ${skipped} non-translatable literal(s)`);
  }
  return rows;
};
// ── Registration ────────────────────────────────────────────────────────────

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
    scan?: ModScanContext;
  },
): Promise<ModImportJob> => {
  await db.query(
    `INSERT INTO mod_imports(
       file_name, file_hash, mod_id, total_records, status,
       src_lang, tgt_lang, is_localized, game, esp_path,
       nexus_mod_id, source_folder, nexus_mod_name
     ) VALUES ($1, $2, NULL, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      params.fileName,
      params.fileHash,
      params.totalRecords,
      params.srcLang,
      params.tgtLang,
      params.isLocalized,
      params.game,
      params.espPath,
      params.scan?.nexusModId ?? null,
      params.scan?.sourceFolder ?? null,
      params.scan?.nexusModName ?? null,
    ],
  );

  const { rows } = await db.query('SELECT * FROM mod_imports WHERE file_hash = $1', [
    params.fileHash,
  ]);
  return rows[0] as ModImportJob;
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
  const buf = fs.readFileSync(pluginPath);
  const fileHash = sha1Hex(buf);

  const { rows: existing } = await db.query('SELECT * FROM mod_imports WHERE file_hash = $1', [
    fileHash,
  ]);
  if (existing[0]) {
    await patchModImportScanContext(db, fileHash, scan);
    const { rows: refreshed } = await db.query('SELECT * FROM mod_imports WHERE file_hash = $1', [
      fileHash,
    ]);
    return refreshed[0] as ModImportJob;
  }

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
    scan,
  });
};

/**
 * Register an archive upload as a mod import job.
 *
 * The archive is extracted into `extractDir`, then the first discovered plugin
 * is used as the import target. If no plugin is found, an error is thrown.
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
  const buf = fs.readFileSync(archivePath);
  const fileHash = sha1Hex(buf);

  const { rows: existing } = await db.query('SELECT * FROM mod_imports WHERE file_hash = $1', [
    fileHash,
  ]);
  if (existing[0]) {
    await patchModImportScanContext(db, fileHash, scan);
    const { rows: refreshed } = await db.query('SELECT * FROM mod_imports WHERE file_hash = $1', [
      fileHash,
    ]);
    return refreshed[0] as ModImportJob;
  }

  await extractArchive(archivePath, extractDir);

  const { plugins } = discoverModFiles(extractDir);

  if (plugins.length === 0) {
    if (!hasMcmTranslationFiles(extractDir)) {
      throw new Error('No ESP/ESM/ESL plugin or MCM translation files found in archive');
    }

    const anchorPath = findFirstMcmTranslationFile(extractDir)!;
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
      scan,
    });
  }

  const pluginPath = plugins[0];
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
    scan,
  });
};

// ── Preview ─────────────────────────────────────────────────────────────────

/**
 * Build a preview of extracted records and detected locales for an import job.
 *
 * The preview uses the first available locale (when localized) to resolve
 * LString IDs to text. The goal is to show representative data in the UI,
 * not to fully export all locales.
 *
 * @param job - Import job row.
 * @param ba2Candidates - Optional BA2 candidate list (e.g. from archive extraction).
 */
export const previewModRecords = (
  job: ModImportJob,
  ba2Candidates: string[] = [],
): {
  rows: ModPreviewRow[];
  locales: string[];
  isLocalized: boolean;
} => {
  const anchorPath = job.esp_path;
  if (!anchorPath || !fs.existsSync(anchorPath)) throw new Error('Import file not found on disk');

  if (!isPluginPath(anchorPath)) {
    const modDir = resolveModDirectoryFromPath(anchorPath);
    const mcmLocales = collectMcmLocalesForMod(modDir, anchorPath);
    const resolved =
      resolveMcmLocaleKey(mcmLocales, MOD_IMPORT_DEFAULT_SOURCE_LOCALE) ??
      (mcmLocales.size > 0
        ? {
            resolvedKey: [...mcmLocales.keys()][0]!,
            value: mcmLocales.get([...mcmLocales.keys()][0]!)!,
          }
        : null);

    const mcmMap = resolved?.value ?? new Map<string, string>();
    const rows: ModPreviewRow[] = [...mcmMap.entries()].slice(0, 200).map(([key, text]) => ({
      formId: '',
      signature: 'MCM',
      edid: '',
      path: `MCM\\${key}`,
      source: text,
    }));

    return {
      rows,
      locales: [...mcmLocales.keys()],
      isLocalized: false,
    };
  }

  const game: GameType = (job.game as GameType) ?? 'fo4';
  const esp = new EspReader(anchorPath, game);
  const espRows = esp.extractStrings();

  const localeSources = discoverLocaleSources(
    anchorPath,
    game,
    ba2Candidates.length > 0 ? ba2Candidates : discoverArchiveCandidatesForPlugin(anchorPath),
  );

  const previewLocale =
    resolveAvailableLocale(localeSourcesByLocale(localeSources), MOD_IMPORT_DEFAULT_SOURCE_LOCALE)
      ?.resolvedKey ??
    localeSources[0]?.locale ??
    null;
  const stringsMap = previewLocale
    ? loadLocaleStrings(localeSourcesByLocale(localeSources).get(previewLocale)!)
    : null;
  const csvRows = materializeImportCsvRows(espRows, stringsMap);

  const rows: ModPreviewRow[] = csvRows.slice(0, 200).map((r) => ({
    formId: r.FormID,
    signature: r.Signature,
    edid: r.EDID ?? '',
    path: r.Path,
    source: r.Source,
  }));

  return {
    rows,
    locales: localeSources.map((s) => s.locale),
    isLocalized: esp.info.isLocalized,
  };
};

// ── Active import tracking ──────────────────────────────────────────────────

interface ActiveImport {
  cancel: boolean;
  pause: boolean;
}

const activeImports = new Map<number, ActiveImport>();

/**
 * Return true if this job id currently has a running import loop.
 */
export const isModImportRunning = (jobId: number): boolean => {
  return activeImports.has(jobId);
};

/**
 * Request cancellation of a running import.
 *
 * Cancellation is cooperative: the import loop checks this flag between record
 * writes and will mark the job as failed with a cancellation reason.
 */
export const requestModCancel = (jobId: number) => {
  const state = activeImports.get(jobId);
  if (state) state.cancel = true;
};

/**
 * Request pausing of a running import.
 *
 * Pausing is cooperative: the import loop checks this flag between record
 * writes and will commit progress and mark the job as paused.
 */
export const requestModPause = (jobId: number) => {
  const state = activeImports.get(jobId);
  if (state) state.pause = true;
};

// ── Import execution ────────────────────────────────────────────────────────

const updateProgress = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE mod_imports SET imported_records = $1, status = 'in_progress', updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
};

const markDone = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE mod_imports SET status = 'completed', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
};

const markFailed = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE mod_imports SET status = 'failed', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
};

const markPaused = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE mod_imports SET status = 'paused', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
};

/**
 * Convert imported strings to translation records.
 *
 * After a mod is imported, creates translation records with status='reviewed' to make
 * content immediately usable without requiring a separate "apply to" step.
 *
 * The function:
 * 1. For strings in srcLang: creates self-translations (srcLang→srcLang) for correction capability
 * 2. For strings in other locales (localized mods only): creates actual translations (locale→srcLang)
 * 3. Deletes all non-srcLang string rows only for localized mods (isLocalized=true)
 *
 * Examples:
 * - Non-localized mod (en): Creates en→en self-translations only, keeps strings
 * - Localized mod (en + ru + de): Creates en→en + ru→en + de→en translations, deletes ru/de strings
 *
 * @param db - Database transaction
 * @param modId - ID of the imported mod
 * @param srcLang - Source language (usually 'en'); default='en'
 * @param isLocalized - Whether this is a localized mod (if true, deletes non-srcLang strings)
 */
/** Minimal `strings` row shape used when aligning locales to source strings. */
export interface ImportStringRow {
  id: number;
  record_id: number;
  lstring_id: number | null;
  text_raw: string;
}

/**
 * Compute a stable per-record alignment key for each string so that records
 * holding multiple strings are paired correctly across locales.
 *
 * - lstring-backed strings use their lstring id (identical across locales).
 * - inline strings (no lstring id) use a positional ordinal within the record;
 *   inline rows are ingested in the same order for every locale, so the Nth
 *   inline string of a record always refers to the same logical field.
 *
 * Input rows MUST be ordered by `(record_id, id)`.
 */
export const alignmentKeyedStrings = (
  rows: ImportStringRow[],
): { key: string; row: ImportStringRow }[] => {
  const inlineOrdinalByRecord = new Map<number, number>();
  return rows.map((row) => {
    let key: string;
    if (row.lstring_id != null) {
      key = `${row.record_id}:L${row.lstring_id}`;
    } else {
      const ordinal = inlineOrdinalByRecord.get(row.record_id) ?? 0;
      inlineOrdinalByRecord.set(row.record_id, ordinal + 1);
      key = `${row.record_id}:P${ordinal}`;
    }
    return { key, row };
  });
};

const convertImportedStringsToTranslations = async (
  db: Tx,
  modId: number,
  srcLang = 'en',
  isLocalized = false,
): Promise<void> => {
  try {
    const localesResult = await db.query<{ lang: string }>(
      `SELECT DISTINCT s.lang
       FROM strings s
       JOIN records r ON r.id = s.record_id
       WHERE r.mod_id = $1 AND s.lang IS NOT NULL`,
      [modId],
    );
    const locales = localesResult.rows.map((r) => r.lang).filter(Boolean);
    if (locales.length === 0) {
      logImport.info(`[ModImport] No strings found for mod ${modId}; skipping conversion`);
      return;
    }

    const localeLookup = new Map(locales.map((locale) => [locale, true]));
    const resolvedSourceLocale =
      resolveAvailableLocale(localeLookup, srcLang)?.resolvedKey ??
      resolveAvailableLocale(localeLookup, MOD_IMPORT_DEFAULT_SOURCE_LOCALE)?.resolvedKey ??
      locales.sort()[0];

    logImport.info(
      `[ModImport] Converting ${locales.length} locale(s) (${locales.join(', ')}) to translations for mod ${modId}; ` +
        `resolved src locale="${resolvedSourceLocale}"` +
        (isLocalized ? ' [localized]' : ' [non-localized]'),
    );

    const { inserted, skippedWithoutSource } = await sqlConvertImportedStringsToTranslations(
      db,
      modId,
      resolvedSourceLocale,
    );

    logImport.info(
      `[ModImport] Created ${inserted} import translations via SQL alignment` +
        (skippedWithoutSource > 0
          ? `; skipped ${skippedWithoutSource} target rows without source pair`
          : ''),
    );

    // After all translations created, delete non-source strings only for localized mods
    // For non-localized mods, keep the source strings alongside their self-translations
    if (isLocalized && srcLang) {
      const deleteNonSrcResult = await db.query(
        `DELETE FROM strings s
         USING records r
         WHERE s.record_id = r.id AND r.mod_id = $1 AND s.lang != $2`,
        [modId, resolvedSourceLocale],
      );
      logImport.info(
        `[ModImport] Deleted ${deleteNonSrcResult.rowCount} non-source language strings (kept ${resolvedSourceLocale})`,
      );
    }
  } catch (err) {
    logImport.error(
      `[ModImport] Error converting ${
        isLocalized ? 'localized' : 'non-localized'
      } strings to translations: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
};

/**
 * Execute a mod import job and ingest extracted strings into the database.
 *
 * The import is resumable based on `job.imported_records` and supports
 * pause/cancel behaviour via {@link requestModPause} / {@link requestModCancel}.
 *
 * @param db - Database handle.
 * @param job - Job row previously returned by {@link registerPluginFile} or {@link registerArchiveFile}.
 * @param onProgress - Optional callback invoked after each committed batch.
 * @returns Final job state.
 */
export const runModImport = async (
  db: Tx,
  job: ModImportJob,
  onProgress?: ProgressCb,
): Promise<ModImportJob> => {
  if (job.status === 'completed') return job;
  if (activeImports.has(job.id)) throw new Error(`Mod Import #${job.id} is already running`);

  const espPath = job.esp_path;
  if (!espPath || !fs.existsSync(espPath)) throw new Error('Plugin file not found');

  const state: ActiveImport = { cancel: false, pause: false };
  activeImports.set(job.id, state);
  const startTime = Date.now();
  let releaseClient: (() => void) | null = null;

  // Keep the whole import on one client session.
  // Using Pool directly can spread BEGIN/COMMIT and writes across connections,
  // which breaks FK-dependent writes in the dialog graph import path.
  if (db instanceof Pool) {
    const client = (await db.connect()) as pg.PoolClient;
    db = client as Tx;
    releaseClient = () => client.release();
  }

  logImport.info(
    `[Mod Import #${job.id}] Starting import of "${job.file_name}" — ${job.total_records} records, resuming from ${job.imported_records} ` +
      `(dbBatch=${CONFIG.dbChunkSize}, ioParallel=${CONFIG.modImportIoParallel}, deferIndexes=${CONFIG.modImportDeferIndexes})`,
  );

  let imported = job.imported_records;
  let deferredIndexes = false;
  const pruneStaleImportData = job.imported_records === 0;
  const keptImportRecordKeys = new Set<string>();
  const keptImportStringIds = new Set<number>();
  const trackImportBatch = (results: ModImportBulkResult[]): void => {
    if (!pruneStaleImportData) return;
    trackModImportBulkResults(results, keptImportRecordKeys, keptImportStringIds);
  };

  try {
    await withModImportWriteLock(db, async () => {
      if (CONFIG.modImportDeferIndexes) {
        deferredIndexes = await tryBeginDeferredImportIndexes(db);
      }

      try {
        const importBatchSize = CONFIG.dbChunkSize;
        const progressEvery = CONFIG.modImportProgressEvery;
        const game: GameType = (job.game as GameType) ?? 'fo4';
        let importModId = job.mod_id;
        if (importModId == null) {
          const modName =
            job.nexus_mod_name?.trim() ||
            (job.source_folder ? parseVortexModFolder(job.source_folder)?.modName : null) ||
            deriveModNameFromFileName(job.file_name);
          importModId = await upsertMod(db, modName, espPath, job.file_hash, game, {
            nexusModId: job.nexus_mod_id ?? undefined,
            nexusName: job.nexus_mod_name ?? undefined,
          });
          if (job.nexus_mod_id) {
            logImport.info(
              `[Mod Import #${job.id}] Nexus link: mod ${job.nexus_mod_id}${job.nexus_mod_name ? ` (${job.nexus_mod_name})` : ''}`,
            );
          }
          await db.query('UPDATE mod_imports SET mod_id = $1, updated_at = NOW() WHERE id = $2', [
            importModId,
            job.id,
          ]);
        }
        const esp = new EspReader(espPath, game);
        const espRows = esp.extractStrings();
        const dialogEdidByFormId = new Map<string, string>();
        for (const row of espRows) {
          if (row.signature === 'DIAL' && row.edid) {
            dialogEdidByFormId.set(row.formId, row.edid);
          }
        }
        const dialogTopicIdCache = new Map<string, number>();

        // Build speaker lookup: INFO record FormID → NPC speaker FormID (from ANAM subrecord)
        const speakerMap = buildSpeakerFormIdMap(espRows);
        // Voice-file fallback: lower-6-hex INFO FormID → speaker display name
        const voiceSpeakerMap = buildVoiceSpeakerMap(espPath);
        // Fallback NPC names for vanilla game NPCs not declared in this mod
        const npcRefMap = loadNpcReferenceMap(game);

        let batchCount = 0;
        let inTx = false;
        let importSingleLocaleMode = false;
        let selectedLocale: string | null = null;
        const archiveCandidates = discoverArchiveCandidatesForPlugin(espPath);
        const pluginStringLang = resolveModStringsLang(
          isImportAllLocalesRequest(job.src_lang) ? MOD_IMPORT_DEFAULT_SOURCE_LOCALE : job.src_lang,
        );

        const localeSources = esp.info.isLocalized
          ? discoverLocaleSources(espPath, game, archiveCandidates)
          : [];

        if (esp.info.isLocalized && localeSources.length === 0) {
          logImport.warn(
            `[Mod Import #${job.id}] Localized plugin without STRINGS files; importing inline strings as "${pluginStringLang}"`,
          );
        }

        const localeCatalog = localeSourcesByLocale(localeSources);
        selectedLocale =
          localeSources.length > 0
            ? resolveSingleImportLocale(
                new Map([...localeCatalog.keys()].map((locale) => [locale, true])),
                job.src_lang,
              )
            : null;
        importSingleLocaleMode = selectedLocale != null;

        const localesToImport = [...localeCatalog.keys()]
          .filter((locale) => !importSingleLocaleMode || locale === selectedLocale)
          .sort();

        let progressTotal = job.total_records;
        if (localesToImport.length > 0) {
          progressTotal = estimateLocalizedImportTotal(espRows, localeSources, localesToImport);
          await db.query('UPDATE mod_imports SET total_records = $1 WHERE id = $2', [
            progressTotal,
            job.id,
          ]);
        }

        const npcNameFromMod = buildNpcNameMap(
          espRows,
          resolveEnglishLocaleMap(localeSources) ?? null,
        );

        const dialogGraphCtx: DialogGraphImportContext = {
          dialogEdidByFormId,
          speakerMap,
          voiceSpeakerMap,
          topicIdCache: dialogTopicIdCache,
        };

        const pendingRows: ModImportBulkRow[] = [];

        const flushPendingImportBatch = async (): Promise<void> => {
          if (pendingRows.length === 0) return;
          const batch = pendingRows.splice(0, pendingRows.length);
          const maxAttempts = 4;

          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              const results = await bulkInsertModImportRows(db, importModId, batch);
              trackImportBatch(results);
              await bulkUpsertDialogGraphForImportBatch(db, importModId, results, dialogGraphCtx);
              imported += results.length;
              batchCount = 0;
              await updateProgress(db, job.id, imported);
              await db.query('COMMIT');
              inTx = false;
              if (
                progressTotal > 0 &&
                (imported >= progressTotal || imported % progressEvery < batch.length)
              ) {
                const pct = ((imported / progressTotal) * 100).toFixed(1);
                logImport.info(
                  `[Mod Import #${job.id}] Progress: ${imported}/${progressTotal} (${pct}%)`,
                );
                onProgress?.(imported, progressTotal);
              }
              return;
            } catch (err) {
              batchCount = 0;
              if (inTx) {
                try {
                  await db.query('ROLLBACK');
                } catch {
                  /* ignore */
                }
                inTx = false;
              }
              if (isPgDeadlockError(err) && attempt < maxAttempts) {
                logImport.warn(
                  `[Mod Import #${job.id}] Deadlock on batch (${batch.length} rows), retry ${attempt}/${maxAttempts - 1}`,
                );
                await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
                continue;
              }
              throw err;
            }
          }
        };

        const discardOpenImportBatch = async (): Promise<void> => {
          pendingRows.length = 0;
          batchCount = 0;
          if (inTx) {
            await db.query('ROLLBACK');
            inTx = false;
          }
        };

        const pushImportRow = async (row: ModImportBulkRow): Promise<void> => {
          if (!inTx) {
            await db.query('BEGIN');
            inTx = true;
          }
          pendingRows.push(row);
          if (pendingRows.length >= importBatchSize) {
            await flushPendingImportBatch();
          }
        };

        let skipRows = job.imported_records;

        if (localesToImport.length > 0) {
          if (importSingleLocaleMode) {
            logImport.info(
              `[Mod Import #${job.id}] Single-locale mode: importing only "${selectedLocale}"`,
            );
          } else {
            logImport.info(
              `[Mod Import #${job.id}] All-localizations mode: importing ${localesToImport.length} locale(s): ${localesToImport.join(', ')}`,
            );
          }

          outer: for (const locale of localesToImport) {
            const stringsMap = loadLocaleStrings(localeCatalog.get(locale)!);
            for (const r of generateImportCsvRows(espRows, stringsMap)) {
              if (skipRows > 0) {
                skipRows--;
                continue;
              }

              if (state.cancel) {
                await discardOpenImportBatch();
                await markFailed(db, job.id, imported);
                logImport.info(`Mod Import #${job.id} cancelled at ${imported}/${progressTotal}`);
                break outer;
              }
              if (state.pause) {
                await discardOpenImportBatch();
                await markPaused(db, job.id, imported);
                logImport.info(`Mod Import #${job.id} paused at ${imported}/${progressTotal}`);
                break outer;
              }

              const speakerFid = r.SpeakerFormID ?? speakerMap.get(r.FormID ?? '');
              const contextLoc = speakerFid
                ? (npcNameFromMod.get(speakerFid) ?? npcRefMap.get(speakerFid) ?? null)
                : null;
              await pushImportRow({
                csvRow: r,
                locale,
                context: contextLoc,
                sourceKind: 'mod-import',
              });
            }
          }
          await flushPendingImportBatch();
        } else {
          if (
            esp.info.isLocalized &&
            espRows.some((row) => row.isLstringId) &&
            localeSources.length === 0
          ) {
            logImport.warn(
              `[Mod Import #${job.id}] Localized plugin "${job.file_name}" has ${espRows.length} string refs but none resolved to text. ` +
                'Ensure STRINGS files exist under Strings\\ or in a companion BA2 (vanilla FO4 base game: "Fallout4 - Interface.ba2").',
            );
          }

          for (const r of generateImportCsvRows(espRows, null)) {
            if (skipRows > 0) {
              skipRows--;
              continue;
            }

            if (state.cancel) {
              await discardOpenImportBatch();
              await markFailed(db, job.id, imported);
              logImport.info(`Mod Import #${job.id} cancelled at ${imported}/${progressTotal}`);
              break;
            }
            if (state.pause) {
              await discardOpenImportBatch();
              await markPaused(db, job.id, imported);
              logImport.info(`Mod Import #${job.id} paused at ${imported}/${progressTotal}`);
              break;
            }

            const speakerFid = r.SpeakerFormID ?? speakerMap.get(r.FormID ?? '');
            const context = speakerFid
              ? (npcNameFromMod.get(speakerFid) ?? npcRefMap.get(speakerFid) ?? null)
              : null;
            await pushImportRow({
              csvRow: r,
              locale: pluginStringLang,
              context,
              sourceKind: 'mod-import',
            });
          }
          await flushPendingImportBatch();
        }

        // ── MCM strings: ingest Interface\Translations\{modName}_*.txt ──
        // Source text always comes from the MCM English (or best available) locale
        // file but is stored under pluginStringLang so it appears alongside ESP rows
        // in the editor. Other locale files become pre-existing translations.
        if (!state.cancel && !state.pause) {
          const mcmModDir = resolveModDirectoryFromPath(espPath);
          const mcmLocales = await collectMcmLocalesForModParallel(mcmModDir, espPath, game);
          const resolvedMcmSource =
            resolveMcmLocaleKey(mcmLocales, MOD_IMPORT_DEFAULT_SOURCE_LOCALE) ??
            resolveMcmLocaleKey(mcmLocales, pluginStringLang);

          if (resolvedMcmSource) {
            const { resolvedKey: mcmSourceLocale, value: sourceMcmMap } = resolvedMcmSource;
            logImport.info(
              `[Mod Import #${job.id}] MCM: ${mcmLocales.size} locale file(s); using "${mcmSourceLocale}" text stored as lang="${pluginStringLang}"`,
            );

            const mcmRows = buildMcmCsvRows(sourceMcmMap);
            const sourceStringIdByKey = new Map<string, number>();
            const mcmBulkRows: ModImportBulkRow[] = mcmRows.map((r) => ({
              csvRow: r,
              locale: pluginStringLang,
              context: null,
              sourceKind: 'mcm',
            }));

            for (let i = 0; i < mcmBulkRows.length; i += importBatchSize) {
              if (!inTx) {
                await db.query('BEGIN');
                inTx = true;
              }
              const slice = mcmBulkRows.slice(i, i + importBatchSize);
              const results = await bulkInsertModImportRows(db, importModId, slice);
              trackImportBatch(results);
              for (const res of results) {
                const mcmKey = res.row.csvRow.Path.replace(/^MCM\\/, '');
                sourceStringIdByKey.set(mcmKey, res.stringId);
              }
              imported += results.length;
              await updateProgress(db, job.id, imported);
              await db.query('COMMIT');
              inTx = false;
              onProgress?.(imported, imported);
            }

            for (const [locale, mcmMap] of mcmLocales) {
              if (locale === mcmSourceLocale) continue;
              if (importSingleLocaleMode && locale !== selectedLocale) continue;

              const items: { srcStringId: number; text: string }[] = [];
              for (const [key, text] of mcmMap) {
                const sourceStringId = sourceStringIdByKey.get(key);
                if (!sourceStringId) continue;
                items.push({ srcStringId: sourceStringId, text });
              }
              const localeCount = await bulkUpsertImportTranslations(db, items, locale, 'mcm');
              if (localeCount > 0) {
                logImport.info(
                  `[Mod Import #${job.id}] MCM locale "${locale}": ${localeCount} translations`,
                );
              }
            }

            logImport.info(
              `[Mod Import #${job.id}] MCM source locale "${mcmSourceLocale}": ${mcmRows.length} strings`,
            );
          } else if (mcmLocales.size > 0) {
            logImport.warn(`[Mod Import #${job.id}] MCM files found but no usable source locale`);
          } else {
            logImport.debug(`[Mod Import #${job.id}] No MCM translation files found`);
          }
        }

        // ── PEX strings: ingest translatable literals from compiled Papyrus scripts ──
        // This runs after MCM, using the same cancel/pause guard. PEX strings use
        // Signature='PEX' and are stored against the source language of the mod.
        // Only runs if the import has not been cancelled or paused.
        if (!state.cancel && !state.pause) {
          const pexMap = await collectPexStrings(espPath, game);
          if (pexMap.size > 0) {
            let decompiled = new Map<string, DecompiledPexScript>();
            try {
              await ensureChampollionInstalled();
              const scriptBuffers = new Map<string, Buffer>();
              for (const [scriptKey, bundle] of pexMap) {
                scriptBuffers.set(scriptKey, bundle.data);
              }
              decompiled = await decompilePexScriptMap(scriptBuffers, importModId);
              logImport.info(
                `[Mod Import #${job.id}] PEX decompile: ${decompiled.size}/${scriptBuffers.size} script(s)`,
              );
            } catch (err) {
              logImport.warn(
                `[Mod Import #${job.id}] Champollion unavailable — PEX filter without PSC (${err instanceof Error ? err.message : String(err)})`,
              );
            }

            const literalBefore = [...pexMap.values()].reduce(
              (sum, b) => sum + b.literals.length,
              0,
            );
            const pexRows = buildPexCsvRows(pexMap, decompiled);
            const skipped = literalBefore - pexRows.length;
            logImport.info(
              `[Mod Import #${job.id}] PEX scripts: ${pexMap.size} script(s), ${pexRows.length} translatable string(s)` +
                (skipped > 0 ? ` (${skipped} filtered)` : ''),
            );
            if (pexRows.length > 0) {
              for (const { csvRow: r, context } of pexRows) {
                await pushImportRow({
                  csvRow: r,
                  locale: pluginStringLang,
                  context,
                  sourceKind: 'pex',
                });
              }
              await flushPendingImportBatch();
            }
          } else {
            logImport.debug(
              `[Mod Import #${job.id}] No PEX scripts with translatable strings found`,
            );
          }
        }

        if (inTx) {
          await db.query('COMMIT');
          inTx = false;
        }

        if (!state.cancel && !state.pause) {
          if (pruneStaleImportData) {
            try {
              const pruned = await pruneStaleModImportData(
                db,
                importModId,
                keptImportRecordKeys,
                keptImportStringIds,
              );
              if (pruned.deletedStrings > 0 || pruned.deletedRecords > 0) {
                logImport.info(
                  `[Mod Import #${job.id}] Pruned stale rows: ${pruned.deletedStrings} string(s), ${pruned.deletedRecords} record(s)`,
                );
              }
            } catch (err) {
              logImport.error(
                `[Mod Import #${job.id}] Failed to prune stale import rows: ${err instanceof Error ? err.message : String(err)}`,
              );
              throw err;
            }
          }

          // Convert imported strings to translation records (both localized and non-localized mods).
          // For localized mods: only convert if we imported all localizations, not a single selected locale.
          // For non-localized mods: always convert to create self-translations (srcLang→srcLang).
          try {
            if (job.is_localized && !importSingleLocaleMode && localeSources.length > 0) {
              await convertImportedStringsToTranslations(
                db,
                importModId,
                MOD_IMPORT_DEFAULT_SOURCE_LOCALE,
                true,
              );
            } else if (!job.is_localized || localeSources.length === 0) {
              await convertImportedStringsToTranslations(db, importModId, pluginStringLang, false);
            }
            // else: localized mod in single-locale mode — skip conversion (imported as regular source strings)
          } catch (err) {
            logImport.error(
              `[Mod Import #${job.id}] Failed to convert strings to translations: ${err instanceof Error ? err.message : String(err)}`,
            );
            throw err;
          }

          // ── Scene import: link DIAL topics into SCEN-based conversation sequences ─
          try {
            const sceneRecords = esp.extractScenes();
            if (sceneRecords.length > 0) {
              await db.query('BEGIN');
              let scenesImported = 0;
              for (const scen of sceneRecords) {
                const sceneId = await upsertDialogScene(
                  db,
                  importModId,
                  scen.formId,
                  scen.edid || null,
                  scen.questFormId,
                );
                for (const action of scen.actions) {
                  // Only link if the topic was actually imported
                  const topicId = dialogTopicIdCache.get(action.topicFormId);
                  if (!topicId) continue;
                  await upsertDialogScenePhase(
                    db,
                    sceneId,
                    action.startPhase,
                    action.aliasId,
                    topicId,
                  );
                }
                scenesImported++;
              }
              await db.query('COMMIT');
              logImport.info(
                `[Mod Import #${job.id}] Imported ${scenesImported} scene(s) with dialog phases`,
              );
            }
          } catch (err) {
            logImport.warn(
              `[Mod Import #${job.id}] Scene import failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
            );
            try {
              await db.query('ROLLBACK');
            } catch {
              /* ignore */
            }
          }

          await markDone(db, job.id, imported);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          logImport.info(`[Mod Import #${job.id}] Completed: ${imported} records in ${elapsed}s`);
          onProgress?.(imported, job.total_records);
        }
      } finally {
        if (deferredIndexes) {
          try {
            await restoreDeferredImportIndexes(db);
          } catch (err) {
            logImport.error(
              `[Mod Import #${job.id}] Failed to restore deferred search indexes: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          deferredIndexes = false;
        }
      }
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logImport.error(`[Mod Import #${job.id}] Failed at ${imported} records: ${errMsg}`);
    await markFailed(db, job.id, imported);
    throw err;
  } finally {
    clearBa2Cache();
    activeImports.delete(job.id);
    releaseClient?.();
  }

  return (await getModImportJob(db, job.id))!;
};

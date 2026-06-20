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
import {
  upsertMod,
  upsertDialogTopic,
  upsertDialogNode,
  upsertDialogEdge,
  upsertDialogScene,
  upsertDialogScenePhase,
  type Tx,
} from '../db';
import { sha1Hex } from '../utils/hash';
import { logImport } from '../logging/loggers';
import { EspReader, type EspStringRow } from '../bethesda/esp';
import { BsaReader, isBa2GnrArchive, getBa2Reader, clearBa2Cache } from '../bethesda/archives';
import { parseStringsBuffer, stringsTypeFromPath } from '../bethesda/strings';
import {
  parseMcmBuffer,
  mcmLocaleFromPath,
  parsePexBuffer,
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
} from '../bethesda/parsers';
import { loadNpcReferenceMap } from '../bethesda/subrecords';
import type { CsvRow, GameType } from '../types';
import { parseVortexModFolder, resolveVortexFolderFromPath } from '../utils/vortexFolder';
import type { VortexFolderInfo } from '../utils/vortexFolder';
import {
  bulkInsertModImportRows,
  bulkUpsertImportTranslations,
  type ModImportBulkRow,
} from './modImportBulk';

const { Pool } = pg;

const BATCH_SIZE = 1000;

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

  const localesMap = loadLocalesForGame(
    anchorPath,
    game,
    discoverArchiveCandidatesForPlugin(anchorPath),
  );
  if (localesMap.size === 0 || importAllLocalizations) return;

  if (!resolveSingleImportLocale(localesMap, srcLang)) {
    const available = [...localesMap.keys()].sort().join(', ');
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
  localesMap: Map<string, Map<number, string>>,
): Map<number, string> | undefined => {
  return (
    resolveAvailableLocale(localesMap, MOD_IMPORT_DEFAULT_SOURCE_LOCALE)?.value ??
    localesMap.get('english') ??
    localesMap.get('en') ??
    [...localesMap.values()][0]
  );
};

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
      const localesMap = loadLocalesForGame(
        anchorPath,
        game,
        discoverArchiveCandidatesForPlugin(anchorPath),
      );
      const resolved = resolveAvailableLocale(localesMap, importedLang);
      if (!resolved) {
        const available = [...localesMap.keys()].sort().join(', ');
        throw new Error(
          available
            ? `Localized import does not contain locale "${importedLang}". Available locales: ${available}`
            : 'Localized import does not contain any STRINGS locales',
        );
      }
      collected.push(...buildCsvRows(espRows, resolved.value));
    } else {
      collected.push(...buildCsvRows(espRows, null));
    }

    const pexMap = collectPexStrings(anchorPath);
    if (pexMap.size > 0) {
      collected.push(...buildPexCsvRows(pexMap));
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
 * Return the BSA archive paired with a Skyrim SE plugin, if one exists.
 * SSE archives use the naming convention `{Stem}.bsa` or `{Stem} - Strings.bsa`
 * (the Strings variant contains only STRINGS/DLSTRINGS/ILSTRINGS files).
 * We look for BSA files in the same directory as the plugin, preferring the
 * `{Stem} - Strings.bsa` variant because it is smaller and faster to load.
 *
 * @param modPath      - Absolute path to the .esp/.esm plugin.
 * @param bsaCandidates - Pre-discovered BSA paths to search first.
 */
const discoverBsa = (modPath: string, bsaCandidates: string[]): string | null => {
  const stem = path.basename(modPath, path.extname(modPath)).toLowerCase();
  const variants = [
    `${stem} - strings`,
    `${stem} - textures`, // occasionally contains strings in Strings subfolder
    stem,
  ];
  for (const bsa of bsaCandidates) {
    const base = path.basename(bsa, '.bsa').toLowerCase();
    if (variants.includes(base)) return bsa;
  }
  const dir = path.dirname(modPath);
  for (const variant of variants) {
    const p = path.join(dir, `${variant}.bsa`);
    if (fs.existsSync(p)) return p;
  }
  return null;
};

/**
 * Load all STRINGS/DLSTRINGS/ILSTRINGS locales from a Skyrim SE BSA archive.
 * BSA archives store strings files under the `strings\\` folder path.
 *
 * @param bsaPath - Absolute path to the .bsa archive.
 */
const loadLocalesFromBSA = (bsaPath: string): Map<string, Map<number, string>> => {
  const reader = new BsaReader(bsaPath);
  const locales = new Map<string, Map<number, string>>();

  const stringsEntries = [
    ...reader.listByExt('strings'),
    ...reader.listByExt('dlstrings'),
    ...reader.listByExt('ilstrings'),
  ];

  for (const entry of stringsEntries) {
    const base = entry.name.replace(/\\/g, '/').split('/').pop() ?? '';
    const m = base.match(/_([a-z]+)\.(strings|dlstrings|ilstrings)$/i);
    if (!m) continue;

    const locale = m[1].toLowerCase();
    const type = stringsTypeFromPath(entry.name);
    const buf = reader.extractEntry(entry);
    const map = parseStringsBuffer(buf, type);

    if (!locales.has(locale)) locales.set(locale, new Map());
    const localeMap = locales.get(locale)!;
    for (const [id, text] of map) localeMap.set(id, text);
  }

  return locales;
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

const loadLocalesFromBA2 = (ba2Path: string): Map<string, Map<number, string>> => {
  const reader = getBa2Reader(ba2Path);
  const locales = new Map<string, Map<number, string>>();

  const stringsEntries = [
    ...reader.listByExt('strings'),
    ...reader.listByExt('dlstrings'),
    ...reader.listByExt('ilstrings'),
  ];

  for (const entry of stringsEntries) {
    const base = entry.name.replace(/\\/g, '/').split('/').pop() ?? '';
    const m = base.match(/_([a-z]+)\.(strings|dlstrings|ilstrings)$/i);
    if (!m) continue;

    const locale = m[1].toLowerCase();
    const type = stringsTypeFromPath(entry.name);
    const buf = reader.extractEntry(entry);
    const map = parseStringsBuffer(buf, type);

    if (!locales.has(locale)) locales.set(locale, new Map());
    const localeMap = locales.get(locale)!;
    for (const [id, text] of map) localeMap.set(id, text);
  }

  return locales;
};

/**
 * Load strings locales for a given game, trying all archive types and loose files.
 * For FO4: loose Strings\ first, then `{Plugin} - Main.ba2`, `{Plugin} - Interface.ba2`
 * (vanilla base game uses Interface), then other stem-prefixed GNRL archives.
 * For SSE: looks for a BSA archive first, then loose Strings\ files.
 *
 * @param espPath      - Absolute path to the plugin.
 * @param game         - Target game ('fo4' or 'sse').
 * @param ba2Candidates - Pre-discovered archive paths (any type).
 */
const loadLocalesForGame = (
  espPath: string,
  game: GameType,
  ba2Candidates: string[] = [],
): Map<string, Map<number, string>> => {
  if (game === 'sse' || game === 'sle' || game === 'fo3' || game === 'fnv') {
    // Skyrim SE / LE / FO3 / FNV: prefer BSA archives, fall back to loose files
    const bsaCandidates = ba2Candidates.filter((f) => f.toLowerCase().endsWith('.bsa'));
    const bsaPath = discoverBsa(espPath, bsaCandidates);
    if (bsaPath) return loadLocalesFromBSA(bsaPath);
    return loadLocalesFromLooseFiles(espPath);
  }
  // fo4 / fo76: prefer loose Strings\ (mods), then companion BA2 archives.
  const ba2Cands = ba2Candidates.filter((f) => f.toLowerCase().endsWith('.ba2'));
  const loose = loadLocalesFromLooseFiles(espPath);
  if (loose.size > 0) return loose;

  const tryLoadFromBa2 = (ba2Path: string): Map<string, Map<number, string>> | null => {
    try {
      const locales = loadLocalesFromBA2(ba2Path);
      return locales.size > 0 ? locales : null;
    } catch (err) {
      logImport.warn(
        `STRINGS: could not read BA2 "${path.basename(ba2Path)}": ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  };

  const primaryBa2 = discoverBa2(espPath, ba2Cands, game);
  if (primaryBa2) {
    const fromPrimary = tryLoadFromBa2(primaryBa2);
    if (fromPrimary) return fromPrimary;
  }

  const stem = path.basename(espPath, path.extname(espPath)).toLowerCase();
  for (const ba2 of ba2Cands) {
    if (ba2 === primaryBa2) continue;
    const base = path.basename(ba2, '.ba2').toLowerCase();
    if (!base.startsWith(stem)) continue;
    if (!isBa2GnrArchive(ba2)) continue;
    const fromBa2 = tryLoadFromBa2(ba2);
    if (fromBa2) return fromBa2;
  }

  return loose;
};

/**
 * Load all STRINGS/DLSTRINGS/ILSTRINGS files from loose disk files.
 * Looks in <modDir>/Strings/ for files matching `{stem}_{locale}.{ext}`.
 *
 * @param modPath - Absolute path to the .esp/.esm plugin.
 */
const loadLocalesFromLooseFiles = (modPath: string): Map<string, Map<number, string>> => {
  const dir = path.join(path.dirname(modPath), 'Strings');
  const locales = new Map<string, Map<number, string>>();
  if (!fs.existsSync(dir)) return locales;

  for (const file of fs.readdirSync(dir)) {
    const m = file.match(/_([a-z]+)\.(strings|dlstrings|ilstrings)$/i);
    if (!m) continue;

    const locale = m[1].toLowerCase();
    const type = stringsTypeFromPath(file);
    const buf = fs.readFileSync(path.join(dir, file));
    const map = parseStringsBuffer(buf, type);

    if (!locales.has(locale)) locales.set(locale, new Map());
    const localeMap = locales.get(locale)!;
    for (const [id, text] of map) localeMap.set(id, text);
  }

  return locales;
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
): Map<string, Map<string, string>> => {
  const modPrefix = resolveMcmModPrefix(modDir, anchorPath);
  const modPrefixes = resolveMcmTranslationPrefixes(modDir, modPrefix);
  const merged = new Map<string, Map<string, string>>();

  for (const ba2Path of listGnrBa2FilesInDir(modDir)) {
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

const buildCsvRows = (
  espRows: EspStringRow[],
  stringsMap: Map<number, string> | null,
): CsvRow[] => {
  const rows: CsvRow[] = [];
  for (const row of espRows) {
    let text: string;
    if (row.isLstringId) {
      if (!stringsMap) continue;
      const id = parseInt(row.text, 10);
      text = stringsMap.get(id) ?? '';
      if (!text) continue;
    } else {
      text = row.text;
    }
    rows.push({
      FormID: row.formId,
      Signature: row.signature,
      EDID: row.edid || undefined,
      Path: `${row.signature}\\${row.path}`,
      LStringID: row.isLstringId ? parseInt(row.text, 10) : undefined,
      Source: text,
      DialogTopicFormID: row.dialogTopicFormId,
      PreviousInfoFormID: row.previousInfoFormId,
      SpeakerFormID: row.speakerFormId,
    });
  }
  return rows;
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

/**
 * Extract translatable strings from all .pex script files inside a BA2 archive.
 * Returns a Map of script name (stem without .psc extension) → string[]
 * so callers can attach a meaningful path to each record.
 *
 * @param ba2Path - Absolute path to the BA2 archive
 */
const loadPexStringsFromBA2 = (ba2Path: string): Map<string, string[]> => {
  const reader = getBa2Reader(ba2Path);
  const result = new Map<string, string[]>();

  for (const entry of reader.listByExt('pex')) {
    try {
      const buf = reader.extractEntry(entry);
      const { info, strings } = parsePexBuffer(buf);
      if (strings.length === 0) continue;
      // Use the declared source file name (without extension) as the key
      const scriptName = info.sourceFile.replace(/\.psc$/i, '') || entry.name;
      result.set(scriptName, strings);
    } catch (err) {
      logImport.debug(`PEX: skipping "${entry.name}": ${err instanceof Error ? err.message : err}`);
    }
  }

  return result;
};

/**
 * Extract translatable strings from loose .pex files found under
 * `<modDir>/Scripts/` on disk.
 * Returns the same Map<scriptName, string[]> shape as {@link loadPexStringsFromBA2}.
 *
 * @param modDir - Directory containing the mod files (parent of the .esp)
 */
const loadPexStringsFromLooseFiles = (modDir: string): Map<string, string[]> => {
  const scriptsDir = path.join(modDir, 'Scripts');
  const result = new Map<string, string[]>();
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
      const { info, strings } = parsePexBuffer(buf);
      if (strings.length === 0) continue;
      const scriptName = info.sourceFile.replace(/\.psc$/i, '') || file.replace(/\.pex$/i, '');
      result.set(scriptName, strings);
    } catch (err) {
      logImport.debug(
        `PEX: skipping loose file "${file}": ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return result;
};

/**
 * Collect all PEX translatable strings for a plugin by scanning every BA2
 * in the plugin's directory and any loose `Scripts/*.pex` files.
 *
 * Merges results so that a script appearing in both a BA2 and loose files
 * prefers the loose file (which may be a patched version).
 *
 * @param espPath - Absolute path to the plugin (.esp/.esm/.esl)
 */
const collectPexStrings = (espPath: string): Map<string, string[]> => {
  const modDir = path.dirname(espPath);
  const merged = new Map<string, string[]>();

  // Scan GNRL BA2 archives only — DX10 texture archives never contain PEX scripts
  for (const ba2Path of listGnrBa2FilesInDir(modDir)) {
    try {
      for (const [script, strings] of loadPexStringsFromBA2(ba2Path)) {
        if (!merged.has(script)) merged.set(script, strings);
        // If already present, BA2 entry wins only if loose files not yet merged
      }
    } catch (err) {
      logImport.warn(
        `PEX: could not read BA2 "${path.basename(ba2Path)}": ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // Loose files override BA2 — applied after so they win on collision
  for (const [script, strings] of loadPexStringsFromLooseFiles(modDir)) {
    merged.set(script, strings);
  }

  return merged;
};

/**
 * Convert a Map of scriptName → string[] into CsvRow objects for DB ingestion.
 *
 * Each unique string in a given script becomes one row:
 *   FormID    : ''              (PEX strings have no ESM FormID)
 *   Signature : 'PEX'           (distinguishes PEX rows in the editor)
 *   Path      : 'PEX\\<script>' (e.g. PEX\\CraftingScript)
 *   Source    : the string literal text
 *
 * Duplicate strings within the same script are deduplicated here to avoid
 * inserting the same text twice (the PEX string table may repeat entries
 * that are referenced from multiple call sites).
 *
 * @param pexMap - Map of script name → array of user-visible strings
 */
const buildPexCsvRows = (pexMap: Map<string, string[]>): CsvRow[] => {
  const rows: CsvRow[] = [];
  for (const [scriptName, strings] of pexMap) {
    const path = `PEX\\${scriptName}`;
    const seen = new Set<string>();
    for (const text of strings) {
      if (seen.has(text)) continue;
      seen.add(text);
      rows.push({
        FormID: '',
        Signature: 'PEX',
        Path: path,
        PathSimplified: path,
        Source: text,
      });
    }
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

  const totalRecords = espRows.length;

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

  const totalRecords = espRows.length;

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

  let localesMap = new Map<string, Map<number, string>>();
  if (esp.info.isLocalized) {
    localesMap = loadLocalesForGame(
      anchorPath,
      game,
      discoverArchiveCandidatesForPlugin(anchorPath),
    );
  }

  const previewLocale =
    resolveAvailableLocale(localesMap, MOD_IMPORT_DEFAULT_SOURCE_LOCALE)?.resolvedKey ??
    [...localesMap.keys()][0] ??
    null;
  const stringsMap = previewLocale ? (localesMap.get(previewLocale) ?? null) : null;
  const csvRows = buildCsvRows(espRows, stringsMap);

  const rows: ModPreviewRow[] = csvRows.map((r) => ({
    formId: r.FormID,
    signature: r.Signature,
    edid: r.EDID ?? '',
    path: r.Path,
    source: r.Source,
  }));

  return {
    rows,
    locales: [...localesMap.keys()],
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
const convertImportedStringsToTranslations = async (
  db: Tx,
  modId: number,
  srcLang = 'en',
  isLocalized = false,
): Promise<void> => {
  try {
    // Find all locales used in this mod
    const localesResult = await db.query(
      `SELECT DISTINCT lang FROM strings WHERE record_id IN (SELECT id FROM records WHERE mod_id = $1) AND lang IS NOT NULL`,
      [modId],
    );

    const locales = (localesResult.rows as { lang: string }[]).map((r) => r.lang).filter((l) => l);
    if (locales.length === 0) {
      logImport.info(`[ModImport] No strings found for mod ${modId}; skipping conversion`);
      return;
    }

    const localeLookup = new Map(locales.map((locale) => [locale, true]));
    const resolvedSourceLocale =
      resolveAvailableLocale(localeLookup, srcLang)?.resolvedKey ??
      resolveAvailableLocale(localeLookup, MOD_IMPORT_DEFAULT_SOURCE_LOCALE)?.resolvedKey ??
      locales.sort()[0];

    const sourceResult = await db.query(
      `SELECT s.id, s.record_id, s.text_raw
       FROM strings s
       WHERE s.record_id IN (SELECT id FROM records WHERE mod_id = $1)
       AND s.lang = $2`,
      [modId, resolvedSourceLocale],
    );

    const sourceRows = sourceResult.rows as { id: number; record_id: number; text_raw: string }[];
    const sourceByRecordId = new Map<number, { id: number; text_raw: string }>();
    for (const row of sourceRows) {
      sourceByRecordId.set(row.record_id, { id: row.id, text_raw: row.text_raw });
    }

    if (sourceByRecordId.size === 0) {
      throw new Error(`Source locale "${resolvedSourceLocale}" not found for mod ${modId}`);
    }

    logImport.info(
      `[ModImport] Converting ${locales.length} locale(s) (${locales.join(', ')}) to translations for mod ${modId}; ` +
        `resolved src locale="${resolvedSourceLocale}"` +
        (isLocalized ? ' [localized]' : ' [non-localized]'),
    );

    // For each locale, create translations anchored to source-locale strings.
    for (const locale of locales) {
      if (locale === resolvedSourceLocale) {
        const items = [...sourceByRecordId.values()].map((source) => ({
          srcStringId: source.id,
          text: source.text_raw,
        }));
        const created = await bulkUpsertImportTranslations(
          db,
          items,
          locale,
          'import_self_translation',
        );
        logImport.info(
          `[ModImport] Created ${created} self-translations for source locale ${locale}`,
        );
        continue;
      }

      const localeStringsResult = await db.query(
        `SELECT s.record_id, s.text_raw
         FROM strings s
         WHERE s.record_id IN (SELECT id FROM records WHERE mod_id = $1)
         AND s.lang = $2`,
        [modId, locale],
      );

      const localeRows = localeStringsResult.rows as { record_id: number; text_raw: string }[];
      const items: { srcStringId: number; text: string }[] = [];
      let skippedWithoutSource = 0;

      for (const localeRow of localeRows) {
        const source = sourceByRecordId.get(localeRow.record_id);
        if (!source) {
          skippedWithoutSource++;
          continue;
        }
        items.push({ srcStringId: source.id, text: localeRow.text_raw });
      }

      const createdForLocale = await bulkUpsertImportTranslations(
        db,
        items,
        locale,
        'import_self_translation',
      );

      logImport.info(
        `[ModImport] Created ${createdForLocale} translations for locale ${locale}` +
          (skippedWithoutSource > 0
            ? `; skipped ${skippedWithoutSource} rows without source pair`
            : ''),
      );
    }

    // After all translations created, delete non-source strings only for localized mods
    // For non-localized mods, keep the source strings alongside their self-translations
    if (isLocalized && srcLang) {
      const deleteNonSrcResult = await db.query(
        `DELETE FROM strings WHERE record_id IN (SELECT id FROM records WHERE mod_id = $1) AND lang != $2`,
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
    `[Mod Import #${job.id}] Starting import of "${job.file_name}" — ${job.total_records} records, resuming from ${job.imported_records}`,
  );

  try {
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

    let imported = job.imported_records;
    let batchCount = 0;
    let inTx = false;
    let importSingleLocaleMode = false;
    let selectedLocale: string | null = null;
    const archiveCandidates = discoverArchiveCandidatesForPlugin(espPath);
    const pluginStringLang = resolveModStringsLang(
      isImportAllLocalesRequest(job.src_lang) ? MOD_IMPORT_DEFAULT_SOURCE_LOCALE : job.src_lang,
    );

    const localesMap: Map<string, Map<number, string>> = esp.info.isLocalized
      ? loadLocalesForGame(espPath, game, archiveCandidates)
      : new Map();

    if (esp.info.isLocalized && localesMap.size === 0) {
      logImport.warn(
        `[Mod Import #${job.id}] Localized plugin without STRINGS files; importing inline strings as "${pluginStringLang}"`,
      );
    }

    const upsertDialogGraphForRow = async (
      row: CsvRow,
      sourceStringId: number,
      speakerName: string | null,
    ): Promise<void> => {
      if (row.Signature !== 'INFO' || !row.FormID || !row.DialogTopicFormID) return;

      let topicId = dialogTopicIdCache.get(row.DialogTopicFormID);
      if (!topicId) {
        topicId = await upsertDialogTopic(
          db,
          importModId,
          row.DialogTopicFormID,
          dialogEdidByFormId.get(row.DialogTopicFormID) ?? null,
        );
        dialogTopicIdCache.set(row.DialogTopicFormID, topicId);
      }

      const speakerFormId = row.SpeakerFormID ?? speakerMap.get(row.FormID) ?? null;
      // Fall back to voice-file directory name when ANAM-based name is unavailable
      const effectiveSpeakerName =
        speakerName ?? voiceSpeakerMap.get(row.FormID.substring(2)) ?? null;
      await upsertDialogNode(
        db,
        topicId,
        row.FormID,
        sourceStringId,
        speakerFormId,
        effectiveSpeakerName,
        row.PreviousInfoFormID ?? null,
      );

      if (row.PreviousInfoFormID) {
        await upsertDialogEdge(
          db,
          topicId,
          row.PreviousInfoFormID,
          row.FormID,
          'previous',
          'exact',
        );
      }
    };

    const pendingRows: ModImportBulkRow[] = [];

    const flushPendingImportBatch = async (progressTotal: number): Promise<void> => {
      if (pendingRows.length === 0) return;
      const batch = pendingRows.splice(0, pendingRows.length);
      try {
        const results = await bulkInsertModImportRows(db, importModId, batch);
        for (const res of results) {
          await upsertDialogGraphForRow(res.row.csvRow, res.stringId, res.row.context);
        }
        imported += results.length;
        batchCount = 0;
        await updateProgress(db, job.id, imported);
        await db.query('COMMIT');
        inTx = false;
        if (progressTotal > 0) {
          const pct = ((imported / progressTotal) * 100).toFixed(1);
          logImport.info(
            `[Mod Import #${job.id}] Progress: ${imported}/${progressTotal} (${pct}%)`,
          );
          onProgress?.(imported, progressTotal);
        }
      } catch (err) {
        pendingRows.length = 0;
        batchCount = 0;
        if (inTx) {
          try {
            await db.query('ROLLBACK');
          } catch {
            /* ignore */
          }
          inTx = false;
        }
        throw err;
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

    const enqueueImportRow = async (
      r: CsvRow,
      locale: string,
      context: string | null,
      progressTotal: number,
      sourceKind?: string,
    ): Promise<void> => {
      if (!inTx) {
        await db.query('BEGIN');
        inTx = true;
        batchCount = 0;
      }
      pendingRows.push({ csvRow: r, locale, context, sourceKind });
      batchCount++;
      if (batchCount >= BATCH_SIZE) {
        await flushPendingImportBatch(progressTotal);
      }
    };

    if (esp.info.isLocalized && localesMap.size > 0) {
      // Resolve NPC names using the English locale when available
      const srcLocaleMap = resolveEnglishLocaleMap(localesMap);
      const npcNameFromMod = buildNpcNameMap(espRows, srcLocaleMap);

      selectedLocale = resolveSingleImportLocale(localesMap, job.src_lang);
      importSingleLocaleMode = selectedLocale != null;

      const work: { locale: string; rows: CsvRow[] }[] = [];
      for (const [locale, strMap] of localesMap) {
        if (importSingleLocaleMode && locale !== selectedLocale) continue;
        work.push({ locale, rows: buildCsvRows(espRows, strMap) });
      }
      const totalAll = work.reduce((s, w) => s + w.rows.length, 0);
      await db.query('UPDATE mod_imports SET total_records = $1 WHERE id = $2', [totalAll, job.id]);

      if (importSingleLocaleMode) {
        logImport.info(
          `[Mod Import #${job.id}] Single-locale mode: importing only "${selectedLocale}"`,
        );
      } else {
        logImport.info(
          `[Mod Import #${job.id}] All-localizations mode: importing ${work.length} locale(s): ${work.map((w) => w.locale).join(', ')}`,
        );
      }

      let globalIdx = 0;

      outer: for (const { locale, rows } of work) {
        for (const r of rows) {
          if (globalIdx++ < job.imported_records) continue;

          if (state.cancel) {
            await discardOpenImportBatch();
            await markFailed(db, job.id, imported);
            logImport.info(`Mod Import #${job.id} cancelled at ${imported}/${totalAll}`);
            break outer;
          }
          if (state.pause) {
            await discardOpenImportBatch();
            await markPaused(db, job.id, imported);
            logImport.info(`Mod Import #${job.id} paused at ${imported}/${totalAll}`);
            break outer;
          }

          const speakerFidLoc = r.SpeakerFormID ?? speakerMap.get(r.FormID ?? '');
          const contextLoc = speakerFidLoc
            ? (npcNameFromMod.get(speakerFidLoc) ?? npcRefMap.get(speakerFidLoc) ?? null)
            : null;
          await enqueueImportRow(r, locale, contextLoc, totalAll);
        }
      }
      await flushPendingImportBatch(totalAll);
    } else {
      // Non-localized plugin, or localized plugin without external STRINGS files.
      const npcNameFromMod = buildNpcNameMap(espRows, null);
      const csvRows = buildCsvRows(espRows, null);

      if (csvRows.length === 0 && espRows.some((row) => row.isLstringId)) {
        logImport.warn(
          `[Mod Import #${job.id}] Localized plugin "${job.file_name}" has ${espRows.length} string refs but none resolved to text. ` +
            'Ensure STRINGS files exist under Strings\\ or in a companion BA2 (vanilla FO4 base game: "Fallout4 - Interface.ba2").',
        );
      }

      for (let i = 0; i < csvRows.length; i++) {
        if (i < job.imported_records) continue;

        if (state.cancel) {
          await discardOpenImportBatch();
          await markFailed(db, job.id, imported);
          logImport.info(`Mod Import #${job.id} cancelled at ${imported}/${job.total_records}`);
          break;
        }
        if (state.pause) {
          await discardOpenImportBatch();
          await markPaused(db, job.id, imported);
          logImport.info(`Mod Import #${job.id} paused at ${imported}/${job.total_records}`);
          break;
        }

        const r = csvRows[i];
        const speakerFid = r.SpeakerFormID ?? speakerMap.get(r.FormID ?? '');
        const context = speakerFid
          ? (npcNameFromMod.get(speakerFid) ?? npcRefMap.get(speakerFid) ?? null)
          : null;
        await enqueueImportRow(r, pluginStringLang, context, csvRows.length);
      }
      await flushPendingImportBatch(csvRows.length);
    }

    // ── MCM strings: ingest Interface\Translations\{modName}_*.txt ──
    // Source text always comes from the MCM English (or best available) locale
    // file but is stored under pluginStringLang so it appears alongside ESP rows
    // in the editor. Other locale files become pre-existing translations.
    if (!state.cancel && !state.pause) {
      const mcmLocales = collectMcmLocales(espPath);
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

        for (let i = 0; i < mcmBulkRows.length; i += BATCH_SIZE) {
          if (!inTx) {
            await db.query('BEGIN');
            inTx = true;
          }
          const slice = mcmBulkRows.slice(i, i + BATCH_SIZE);
          const results = await bulkInsertModImportRows(db, importModId, slice);
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
      const pexMap = collectPexStrings(espPath);
      if (pexMap.size > 0) {
        const pexRows = buildPexCsvRows(pexMap);
        logImport.info(
          `[Mod Import #${job.id}] PEX scripts: ${pexMap.size} script(s), ${pexRows.length} unique string(s)`,
        );
        if (pexRows.length > 0) {
          for (const r of pexRows) {
            await enqueueImportRow(r, pluginStringLang, null, pexRows.length, 'pex');
          }
          await flushPendingImportBatch(pexRows.length);
        }
      } else {
        logImport.debug(`[Mod Import #${job.id}] No PEX scripts with translatable strings found`);
      }
    }

    if (inTx) {
      await db.query('COMMIT');
      inTx = false;
    }

    if (!state.cancel && !state.pause) {
      // Convert imported strings to translation records (both localized and non-localized mods).
      // For localized mods: only convert if we imported all localizations, not a single selected locale.
      // For non-localized mods: always convert to create self-translations (srcLang→srcLang).
      try {
        if (job.is_localized && !importSingleLocaleMode && localesMap.size > 0) {
          await convertImportedStringsToTranslations(
            db,
            importModId,
            MOD_IMPORT_DEFAULT_SOURCE_LOCALE,
            true,
          );
        } else if (!job.is_localized || localesMap.size === 0) {
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
              await upsertDialogScenePhase(db, sceneId, action.startPhase, action.aliasId, topicId);
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
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logImport.error(`[Mod Import #${job.id}] Failed: ${errMsg}`);
    await markFailed(db, job.id, job.imported_records);
    throw err;
  } finally {
    clearBa2Cache();
    activeImports.delete(job.id);
    releaseClient?.();
  }

  return (await getModImportJob(db, job.id))!;
};

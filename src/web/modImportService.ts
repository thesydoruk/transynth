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
import { upsertMod, upsertRecord, insertString, type Tx } from '../db.js';
import { upsertTranslation } from './queries.js';
import { sha1Hex } from '../utils/hash.js';
import { normalizeForHash, normalizeNoPunct } from '../utils/textNorm.js';
import { log } from '../logger.js';
import { EspReader, type EspStringRow } from '../bethesda/espReader.js';
import { Ba2Reader } from '../bethesda/ba2Reader.js';
import { BsaReader } from '../bethesda/bsaReader.js';
import { parseStringsBuffer, stringsTypeFromPath } from '../bethesda/stringsFile.js';
import { parseMcmBuffer, mcmLocaleFromPath } from '../bethesda/mcmReader.js';
import { parsePexBuffer } from '../bethesda/pexReader.js';
import type { CsvRow, GameType } from '../types.js';

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
  status: string;          // pending | extracting | in_progress | paused | failed | completed
  src_lang: string;
  tgt_lang: string;
  is_localized: number;    // 0 | 1
  game: GameType;          // fo4 | sse
  esp_path: string | null;
  created_at: string;
  updated_at: string;
}

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

export const ensureModImportSchema = async (_db: Tx) => {
  // No runtime schema patch is needed at the moment.
  return;
}

// ── CRUD helpers ────────────────────────────────────────────────────────────

/**
 * List all mod import jobs ordered by newest first.
 */
export const listModImportJobs = async (db: Tx): Promise<ModImportJob[]> => {
  const { rows } = await db.query('SELECT * FROM mod_imports ORDER BY created_at DESC');
  return rows as ModImportJob[];
}

/**
 * Fetch a single import job by id.
 */
export const getModImportJob = async (db: Tx, id: number): Promise<ModImportJob | undefined> => {
  const { rows } = await db.query('SELECT * FROM mod_imports WHERE id = $1', [id]);
  return rows[0] as ModImportJob | undefined;
}

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
}

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
}

/**
 * Delete an import job row.
 *
 * Note: this does not delete any ingested strings/records for the associated
 * mod; it only removes the job tracker.
 */
export const deleteModImportJob = async (db: Tx, id: number) => {
  await db.query('DELETE FROM mod_imports WHERE id = $1', [id]);
}

/**
 * Derive a stable mod display name from the uploaded file name.
 *
 * The same rule is used for direct plugin uploads and archive uploads so the
 * later DB ingestion step produces the same mod name as the previous eager
 * registration flow.
 */
const deriveModNameFromFileName = (fileName: string): string => {
  return fileName.replace(/\.(esp|esm|esl|zip|7z|rar)$/i, '');
}

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

  const aliases = new Map<string, string[]>([
    ['en', ['en', 'english']],
    ['ru', ['ru', 'russian']],
    ['uk', ['uk', 'ukrainian']],
    ['cs', ['cs', 'czech']],
    ['de', ['de', 'german']],
    ['fr', ['fr', 'french']],
    ['es', ['es', 'spanish']],
    ['it', ['it', 'italian']],
    ['pt', ['pt', 'portuguese']],
    ['pl', ['pl', 'polish']],
    ['ja', ['ja', 'japanese']],
    ['zh', ['zh', 'chinese']],
    ['ko', ['ko', 'korean']],
  ]);

  const candidates = aliases.get(requested) ?? [requested];
  for (const candidate of candidates) {
    const value = locales.get(candidate);
    if (value !== undefined) {
      return { resolvedKey: candidate, value };
    }
  }

  return null;
}

/**
 * Convert generic CSV-style rows into the canonical imported-row shape used by
 * the translation-apply matcher.
 */
const toApplyRows = (rows: CsvRow[]): ModImportApplyRow[] => rows.map((row) => ({
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
  const espPath = job.esp_path;
  if (!espPath || !fs.existsSync(espPath)) throw new Error('Plugin file not found on disk');

  const game: GameType = (job.game as GameType) ?? 'fo4';
  const esp = new EspReader(espPath, game);
  const espRows = esp.extractStrings();
  const collected: CsvRow[] = [];

  if (esp.info.isLocalized) {
    const localesMap = loadLocalesForGame(espPath, game, []);
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

  const mcmLocales = collectMcmLocales(espPath);
  const resolvedMcm = resolveAvailableLocale(mcmLocales, importedLang);
  if (resolvedMcm) {
    collected.push(...buildMcmCsvRows(resolvedMcm.value));
  }

  const pexMap = collectPexStrings(espPath);
  if (pexMap.size > 0) {
    collected.push(...buildPexCsvRows(pexMap));
  }

  return toApplyRows(collected);
}

// ── Archive extraction ──────────────────────────────────────────────────────

const ARCHIVE_EXTS = new Set(['.zip', '.7z', '.rar']);
const PLUGIN_EXTS = new Set(['.esp', '.esm', '.esl']);

/**
 * Return true if the file name looks like a supported archive type.
 */
export const isArchive = (fileName: string): boolean => {
  return ARCHIVE_EXTS.has(path.extname(fileName).toLowerCase());
}

/**
 * Return true if the file name looks like a supported plugin type.
 */
export const isPlugin = (fileName: string): boolean => {
  return PLUGIN_EXTS.has(path.extname(fileName).toLowerCase());
}

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
    `${stem} - textures`,  // occasionally contains strings in Strings subfolder
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
}

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
}

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
    execFile('unrar', ['x', '-y', '-o+', archivePath, `${outDir}${path.sep}`], (err, _stdout, stderr) => {
      if (!err) return resolve();

      // Provide a helpful message when unrar is not installed
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reject(new Error(
          'RAR extraction requires "unrar" to be installed. '
          + 'On Linux/Docker: apt-get install unrar. '
          + 'On Windows (dev): install WinRAR or standalone unrar.exe and add to PATH.',
        ));
      }

      reject(new Error(`unrar failed: ${stderr || err.message}`));
    });
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
export const discoverModFiles = (dir: string): { plugins: string[]; ba2s: string[]; bsas: string[] } => {
  const plugins: string[] = [];
  const ba2s: string[] = [];
  const bsas: string[] = [];

  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      const ext = path.extname(entry.name).toLowerCase();
      if (PLUGIN_EXTS.has(ext)) plugins.push(full);
      else if (ext === '.ba2') ba2s.push(full);
      else if (ext === '.bsa') bsas.push(full);
    }
  }
  walk(dir);
  return { plugins, ba2s, bsas };
}

const discoverBa2 = (modPath: string, ba2Candidates: string[]): string | null => {
  const stem = path.basename(modPath, path.extname(modPath)).toLowerCase();
  for (const ba2 of ba2Candidates) {
    const ba2Base = path.basename(ba2, '.ba2').toLowerCase();
    if (ba2Base === `${stem} - main` || ba2Base === stem) return ba2;
  }
  const dir = path.dirname(modPath);
  for (const candidate of [`${path.basename(modPath, path.extname(modPath))} - Main.ba2`, `${path.basename(modPath, path.extname(modPath))}.ba2`]) {
    const p = path.join(dir, candidate);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const loadLocalesFromBA2 = (ba2Path: string): Map<string, Map<number, string>> => {
  const reader = new Ba2Reader(ba2Path);
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
}

/**
 * Load strings locales for a given game, trying all archive types and loose files.
 * For FO4: looks for a BA2 archive first, then loose Strings\ files.
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
  // fo4 (default)
  const ba2Cands = ba2Candidates.filter((f) => f.toLowerCase().endsWith('.ba2'));
  const ba2Path = discoverBa2(espPath, ba2Cands);
  if (ba2Path) return loadLocalesFromBA2(ba2Path);
  return loadLocalesFromLooseFiles(espPath);
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
}

/**
 * Load all MCM translation files from a BA2 archive.
 * Only considers files under the Interface\Translations\ path.
 * Returns a Map of lowercase locale name (e.g. "english") → Map of $key → text.
 *
 * @param ba2Path - Absolute path to the BA2 archive
 */
const loadMcmLocalesFromBA2 = (ba2Path: string): Map<string, Map<string, string>> => {
  const reader = new Ba2Reader(ba2Path);
  const locales = new Map<string, Map<string, string>>();

  // Only look at .txt files inside the Interface\Translations\ directory.
  const txtEntries = reader
    .listByExt('txt')
    .filter((e) => e.name.toLowerCase().includes('interface') && e.name.toLowerCase().includes('translations'));

  for (const entry of txtEntries) {
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
 * Looks in <modDir>/Interface/Translations/ for *.txt files.
 *
 * @param modDir - Directory containing the mod files
 */
const loadMcmLocalesFromLooseFiles = (modDir: string): Map<string, Map<string, string>> => {
  const dir = path.join(modDir, 'Interface', 'Translations');
  const locales = new Map<string, Map<string, string>>();
  if (!fs.existsSync(dir)) return locales;

  for (const file of fs.readdirSync(dir)) {
    if (!file.toLowerCase().endsWith('.txt')) continue;
    const locale = mcmLocaleFromPath(file);
    if (!locale) continue;

    const buf = fs.readFileSync(path.join(dir, file));
    const mcmMap = parseMcmBuffer(buf);
    if (mcmMap.size === 0) continue;

    if (!locales.has(locale)) locales.set(locale, new Map());
    const existing = locales.get(locale)!;
    for (const [k, v] of mcmMap) existing.set(k, v);
  }

  return locales;
};

/**
 * Collect all MCM locales for a plugin by scanning all BA2s in the plugin’s
 * directory and any loose Interface\Translations files.
 *
 * @param espPath - Absolute path to the plugin (.esp/.esm/.esl)
 */
const collectMcmLocales = (espPath: string): Map<string, Map<string, string>> => {
  const modDir = path.dirname(espPath);
  const merged = new Map<string, Map<string, string>>();

  // Scan every BA2 in the mod directory for MCM translation txt files
  let ba2Files: string[] = [];
  try {
    ba2Files = fs
      .readdirSync(modDir)
      .filter((f) => f.toLowerCase().endsWith('.ba2'))
      .map((f) => path.join(modDir, f));
  } catch {
    // Directory unreadable — skip
  }

  for (const ba2Path of ba2Files) {
    try {
      for (const [locale, mcmMap] of loadMcmLocalesFromBA2(ba2Path)) {
        if (!merged.has(locale)) merged.set(locale, new Map());
        for (const [k, v] of mcmMap) merged.get(locale)!.set(k, v);
      }
    } catch (err) {
      log.warn(`MCM: could not read BA2 "${path.basename(ba2Path)}": ${err instanceof Error ? err.message : err}`);
    }
  }

  // Also check loose Interface/Translations files
  for (const [locale, mcmMap] of loadMcmLocalesFromLooseFiles(modDir)) {
    if (!merged.has(locale)) merged.set(locale, new Map());
    for (const [k, v] of mcmMap) merged.get(locale)!.set(k, v);
  }

  return merged;
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
    });
  }
  return rows;
}

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
  const reader = new Ba2Reader(ba2Path);
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
      log.debug(`PEX: skipping "${entry.name}": ${err instanceof Error ? err.message : err}`);
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
      log.debug(`PEX: skipping loose file "${file}": ${err instanceof Error ? err.message : err}`);
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

  // Scan every BA2 in the mod directory
  let ba2Files: string[] = [];
  try {
    ba2Files = fs
      .readdirSync(modDir)
      .filter((f) => f.toLowerCase().endsWith('.ba2'))
      .map((f) => path.join(modDir, f));
  } catch {
    // Directory unreadable — skip
  }

  for (const ba2Path of ba2Files) {
    try {
      for (const [script, strings] of loadPexStringsFromBA2(ba2Path)) {
        if (!merged.has(script)) merged.set(script, strings);
        // If already present, BA2 entry wins only if loose files not yet merged
      }
    } catch (err) {
      log.warn(`PEX: could not read BA2 "${path.basename(ba2Path)}": ${err instanceof Error ? err.message : err}`);
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
): Promise<ModImportJob> => {
  const buf = fs.readFileSync(pluginPath);
  const fileHash = sha1Hex(buf);

  const { rows: existing } = await db.query('SELECT * FROM mod_imports WHERE file_hash = $1', [fileHash]);
  if (existing[0]) return existing[0] as ModImportJob;

  const esp = new EspReader(pluginPath, game);
  const espRows = esp.extractStrings();
  const isLocalized = esp.info.isLocalized ? 1 : 0;

  const totalRecords = espRows.length;

  await db.query(
    `INSERT INTO mod_imports(file_name, file_hash, mod_id, total_records, status, src_lang, tgt_lang, is_localized, game, esp_path)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9)`,
    [fileName, fileHash, null, totalRecords, srcLang, tgtLang, isLocalized, game, pluginPath],
  );

  const { rows } = await db.query('SELECT * FROM mod_imports WHERE file_hash = $1', [fileHash]);
  return rows[0] as ModImportJob;
}

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
): Promise<ModImportJob> => {
  const buf = fs.readFileSync(archivePath);
  const fileHash = sha1Hex(buf);

  const { rows: existing } = await db.query('SELECT * FROM mod_imports WHERE file_hash = $1', [fileHash]);
  if (existing[0]) return existing[0] as ModImportJob;

  await extractArchive(archivePath, extractDir);

  const { plugins } = discoverModFiles(extractDir);

  if (plugins.length === 0) {
    throw new Error('No ESP/ESM/ESL plugin found in archive');
  }

  const pluginPath = plugins[0];
  const esp = new EspReader(pluginPath, game);
  const espRows = esp.extractStrings();
  const isLocalized = esp.info.isLocalized ? 1 : 0;

  const totalRecords = espRows.length;

  await db.query(
    `INSERT INTO mod_imports(file_name, file_hash, mod_id, total_records, status, src_lang, tgt_lang, is_localized, game, esp_path)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9)`,
    [fileName, fileHash, null, totalRecords, srcLang, tgtLang, isLocalized, game, pluginPath],
  );

  const { rows } = await db.query('SELECT * FROM mod_imports WHERE file_hash = $1', [fileHash]);
  return rows[0] as ModImportJob;
}

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
export const previewModRecords = (job: ModImportJob, ba2Candidates: string[] = []): {
  rows: ModPreviewRow[];
  locales: string[];
  isLocalized: boolean;
} => {
  const espPath = job.esp_path;
  if (!espPath || !fs.existsSync(espPath)) throw new Error('Plugin file not found on disk');

  const game: GameType = (job.game as GameType) ?? 'fo4';
  const esp = new EspReader(espPath, game);
  const espRows = esp.extractStrings();

  let localesMap = new Map<string, Map<number, string>>();
  if (esp.info.isLocalized) {
    localesMap = loadLocalesForGame(espPath, game, ba2Candidates);
  }

  const firstLocale = localesMap.size > 0 ? [...localesMap.keys()][0] : null;
  const stringsMap = firstLocale ? (localesMap.get(firstLocale) ?? null) : null;
  const csvRows = buildCsvRows(espRows, stringsMap);

  const rows: ModPreviewRow[] = csvRows.map(r => ({
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
}

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
}

/**
 * Request cancellation of a running import.
 *
 * Cancellation is cooperative: the import loop checks this flag between record
 * writes and will mark the job as failed with a cancellation reason.
 */
export const requestModCancel = (jobId: number) => {
  const state = activeImports.get(jobId);
  if (state) state.cancel = true;
}

/**
 * Request pausing of a running import.
 *
 * Pausing is cooperative: the import loop checks this flag between record
 * writes and will commit progress and mark the job as paused.
 */
export const requestModPause = (jobId: number) => {
  const state = activeImports.get(jobId);
  if (state) state.pause = true;
}

// ── Import execution ────────────────────────────────────────────────────────

const updateProgress = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE mod_imports SET imported_records = $1, status = 'in_progress', updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
}

const markDone = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE mod_imports SET status = 'completed', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
}

const markFailed = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE mod_imports SET status = 'failed', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
}

const markPaused = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE mod_imports SET status = 'paused', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
}

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

    const locales = (localesResult.rows as { lang: string }[]).map(r => r.lang).filter(l => l);
    if (locales.length === 0) {
      log.info(`[ModImport] No strings found for mod ${modId}; skipping conversion`);
      return;
    }

    const localeLookup = new Map(locales.map((locale) => [locale, true]));
    const resolvedSourceLocale = resolveAvailableLocale(localeLookup, srcLang)?.resolvedKey ?? srcLang;

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

    log.info(
      `[ModImport] Converting ${locales.length} locale(s) (${locales.join(', ')}) to translations for mod ${modId}; ` +
      `resolved src locale="${resolvedSourceLocale}"` +
      (isLocalized ? ' [localized]' : ' [non-localized]'),
    );

    // For each locale, create translations anchored to source-locale strings.
    for (const locale of locales) {
      if (locale === resolvedSourceLocale) {
        // Keep a self-translation for source locale so source text can be edited in target column too.
        for (const source of sourceByRecordId.values()) {
          await upsertTranslation(db, source.id, source.text_raw, 'reviewed', locale, 'import_self_translation');
        }
        log.info(`[ModImport] Created ${sourceByRecordId.size} self-translations for source locale ${locale}`);
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
      let createdForLocale = 0;
      let skippedWithoutSource = 0;

      for (const localeRow of localeRows) {
        const source = sourceByRecordId.get(localeRow.record_id);
        if (!source) {
          skippedWithoutSource++;
          continue;
        }

        await upsertTranslation(db, source.id, localeRow.text_raw, 'reviewed', locale, 'import_self_translation');
        createdForLocale++;
      }

      log.info(
        `[ModImport] Created ${createdForLocale} translations for locale ${locale}` +
        (skippedWithoutSource > 0 ? `; skipped ${skippedWithoutSource} rows without source pair` : ''),
      );
    }

    // After all translations created, delete non-source strings only for localized mods
    // For non-localized mods, keep the source strings alongside their self-translations
    if (isLocalized && srcLang) {
      const deleteNonSrcResult = await db.query(
        `DELETE FROM strings WHERE record_id IN (SELECT id FROM records WHERE mod_id = $1) AND lang != $2`,
        [modId, resolvedSourceLocale],
      );
      log.info(`[ModImport] Deleted ${deleteNonSrcResult.rowCount} non-source language strings (kept ${resolvedSourceLocale})`);
    }
  } catch (err) {
    log.error(
      `[ModImport] Error converting ${
        isLocalized ? 'localized' : 'non-localized'
      } strings to translations: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}

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

  log.info(`[Mod Import #${job.id}] Starting import of "${job.file_name}" — ${job.total_records} records, resuming from ${job.imported_records}`);

  try {
    const game: GameType = (job.game as GameType) ?? 'fo4';
    let importModId = job.mod_id;
    if (importModId == null) {
      const modName = deriveModNameFromFileName(job.file_name);
      importModId = await upsertMod(db, modName, espPath, job.file_hash, game);
      await db.query('UPDATE mod_imports SET mod_id = $1, updated_at = NOW() WHERE id = $2', [importModId, job.id]);
    }
    const esp = new EspReader(espPath, game);
    const espRows = esp.extractStrings();

    let imported = job.imported_records;
    let batchCount = 0;
    let inTx = false;
    let importSingleLocaleMode = false;  // Track whether we imported a single selected locale vs. all

    if (esp.info.isLocalized) {
      const localesMap: Map<string, Map<number, string>> = loadLocalesForGame(espPath, game, []);
      if (localesMap.size === 0) throw new Error('No locales found in BA2 / strings files');

      // When user selects a specific locale for single-language import (not all localizations),
      // only import that locale. Otherwise, import all available locales.
      const selectedLocale = job.src_lang !== 'en' && localesMap.has(job.src_lang) ? job.src_lang : null;
      importSingleLocaleMode = selectedLocale != null;

      const work: { locale: string; rows: CsvRow[] }[] = [];
      for (const [locale, strMap] of localesMap) {
        // If user selected a specific locale, only process that one
        if (importSingleLocaleMode && locale !== selectedLocale) continue;
        work.push({ locale, rows: buildCsvRows(espRows, strMap) });
      }
      const totalAll = work.reduce((s, w) => s + w.rows.length, 0);
      await db.query('UPDATE mod_imports SET total_records = $1 WHERE id = $2', [totalAll, job.id]);

      if (importSingleLocaleMode) {
        log.info(`[Mod Import #${job.id}] Single-locale mode: importing only "${selectedLocale}"`);
      } else {
        log.info(`[Mod Import #${job.id}] All-localizations mode: importing ${localesMap.size} locale(s)`);
      }

      let globalIdx = 0;

      outer:
      for (const { locale, rows } of work) {
        for (const r of rows) {
          if (globalIdx++ < job.imported_records) continue;

          if (state.cancel) {
            if (inTx) { await db.query('COMMIT'); inTx = false; }
            await markFailed(db, job.id, imported);
            log.info(`Mod Import #${job.id} cancelled at ${imported}/${totalAll}`);
            break outer;
          }
          if (state.pause) {
            if (inTx) { await db.query('COMMIT'); inTx = false; }
            await markPaused(db, job.id, imported);
            log.info(`Mod Import #${job.id} paused at ${imported}/${totalAll}`);
            break outer;
          }

          if (!inTx) { await db.query('BEGIN'); inTx = true; batchCount = 0; }

          const pathSimplified = r.Path.replace(/\[\d+\]/g, '');
          const hashNorm = sha1Hex(normalizeForHash(r.Source));
          const recordId = await upsertRecord(db, importModId, r.Signature, r.Path, pathSimplified, r.EDID ?? null, hashNorm, r.FormID || null);
          await insertString(db, recordId, locale, r.Source, normalizeForHash(r.Source), 'mod-import', undefined, normalizeNoPunct(r.Source));

          imported++;
          batchCount++;

          if (batchCount >= BATCH_SIZE) {
            await updateProgress(db, job.id, imported);
            await db.query('COMMIT');
            inTx = false;
            const pct = ((imported / totalAll) * 100).toFixed(1);
            log.info(`[Mod Import #${job.id}] Progress: ${imported}/${totalAll} (${pct}%)`);
            onProgress?.(imported, totalAll);
          }
        }
      }
    } else {
      // ── Non-localized plugin: import with single selected language ─────
      const csvRows = buildCsvRows(espRows, null);

      for (let i = 0; i < csvRows.length; i++) {
        if (i < job.imported_records) continue;

        if (state.cancel) {
          if (inTx) { await db.query('COMMIT'); inTx = false; }
          await markFailed(db, job.id, imported);
          log.info(`Mod Import #${job.id} cancelled at ${imported}/${job.total_records}`);
          break;
        }
        if (state.pause) {
          if (inTx) { await db.query('COMMIT'); inTx = false; }
          await markPaused(db, job.id, imported);
          log.info(`Mod Import #${job.id} paused at ${imported}/${job.total_records}`);
          break;
        }

        if (!inTx) { await db.query('BEGIN'); inTx = true; batchCount = 0; }

        const r = csvRows[i];
        const pathSimplified = r.Path.replace(/\[\d+\]/g, '');
        const hashNorm = sha1Hex(normalizeForHash(r.Source));
        const recordId = await upsertRecord(db, importModId, r.Signature, r.Path, pathSimplified, r.EDID ?? null, hashNorm, r.FormID || null);
        await insertString(db, recordId, job.src_lang, r.Source, normalizeForHash(r.Source), 'mod-import', undefined, normalizeNoPunct(r.Source));

        imported++;
        batchCount++;

        if (batchCount >= BATCH_SIZE) {
          await updateProgress(db, job.id, imported);
          await db.query('COMMIT');
          inTx = false;
          const pct = ((imported / csvRows.length) * 100).toFixed(1);
          log.info(`[Mod Import #${job.id}] Progress: ${imported}/${csvRows.length} (${pct}%)`);
          onProgress?.(imported, csvRows.length);
        }
      }
    }

    // ── MCM strings: ingest any Interface\Translations\*.txt from BA2s ──
    // This runs after all ESP records are processed, so cancellation during
    // ESP short-circuits safely. MCM strings use Signature='MCM' to keep
    // them visually distinct from ESP-sourced strings in the editor.
    if (!state.cancel && !state.pause) {
      const mcmLocales = collectMcmLocales(espPath);
      if (mcmLocales.size > 0) {
        log.info(`[Mod Import #${job.id}] MCM translations found for ${mcmLocales.size} locale(s)`);
        for (const [locale, mcmMap] of mcmLocales) {
          const mcmRows = buildMcmCsvRows(mcmMap);
          if (!inTx) { await db.query('BEGIN'); inTx = true; batchCount = 0; }
          for (const r of mcmRows) {
            const hashNorm = sha1Hex(normalizeForHash(r.Source));
            const recordId = await upsertRecord(db, importModId, r.Signature, r.Path, r.PathSimplified ?? r.Path, null, hashNorm, '');
            await insertString(db, recordId, locale, r.Source, normalizeForHash(r.Source), 'mcm', undefined, normalizeNoPunct(r.Source));
            imported++;
            batchCount++;
            if (batchCount >= BATCH_SIZE) {
              await updateProgress(db, job.id, imported);
              await db.query('COMMIT');
              inTx = false;
              batchCount = 0;
              onProgress?.(imported, imported);
            }
          }
          log.info(`[Mod Import #${job.id}] MCM locale "${locale}": ${mcmRows.length} strings`);
        }
      } else {
        log.debug(`[Mod Import #${job.id}] No MCM translation files found`);
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
        log.info(`[Mod Import #${job.id}] PEX scripts: ${pexMap.size} script(s), ${pexRows.length} unique string(s)`);
        if (pexRows.length > 0) {
          if (!inTx) { await db.query('BEGIN'); inTx = true; batchCount = 0; }
          for (const r of pexRows) {
            const hashNorm = sha1Hex(normalizeForHash(r.Source));
            const recordId = await upsertRecord(db, importModId, r.Signature, r.Path, r.PathSimplified ?? r.Path, null, hashNorm, '');
            await insertString(db, recordId, job.src_lang, r.Source, normalizeForHash(r.Source), 'pex', undefined, normalizeNoPunct(r.Source));
            imported++;
            batchCount++;
            if (batchCount >= BATCH_SIZE) {
              await updateProgress(db, job.id, imported);
              await db.query('COMMIT');
              inTx = false;
              batchCount = 0;
              onProgress?.(imported, imported);
            }
          }
        }
      } else {
        log.debug(`[Mod Import #${job.id}] No PEX scripts with translatable strings found`);
      }
    }

    if (inTx) { await db.query('COMMIT'); inTx = false; }

    if (!state.cancel && !state.pause) {
      // Convert imported strings to translation records (both localized and non-localized mods).
      // For localized mods: only convert if we imported all localizations, not a single selected locale.
      // For non-localized mods: always convert to create self-translations (srcLang→srcLang).
      try {
        if (job.is_localized && !importSingleLocaleMode) {
          // Localized mod with all-localizations mode: convert all locales, delete non-srcLang strings
          await convertImportedStringsToTranslations(db, importModId, job.src_lang, true);
        } else if (!job.is_localized) {
          // Non-localized mod: create self-translations for srcLang, keep strings
          await convertImportedStringsToTranslations(db, importModId, job.src_lang, false);
        }
        // else: localized mod in single-locale mode — skip conversion (imported as regular source strings)
      } catch (err) {
        log.error(`[Mod Import #${job.id}] Failed to convert strings to translations: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }

      await markDone(db, job.id, imported);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      log.info(`[Mod Import #${job.id}] Completed: ${imported} records in ${elapsed}s`);
      onProgress?.(imported, job.total_records);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error(`[Mod Import #${job.id}] Failed: ${errMsg}`);
    await markFailed(db, job.id, job.imported_records);
    throw err;
  } finally {
    activeImports.delete(job.id);
  }

  return (await getModImportJob(db, job.id))!;
}

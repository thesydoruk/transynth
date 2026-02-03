/**
 * Mod import service — upload ESP/ESL (or archive with ESP+BA2),
 * extract strings, and ingest into the DB.
 * Supports pause, cancel, resume and progress callbacks.
 */
import fs from 'node:fs';
import path from 'node:path';
import Seven from 'node-7z';
import { path7za } from '7zip-bin';
import { upsertMod, upsertRecord, insertString, type Tx } from '../db.js';
import { sha1Hex } from '../utils/hash.js';
import { normalizeForHash, normalizeNoPunct } from '../utils/textNorm.js';
import { log } from '../logger.js';
import { EspReader, type EspStringRow } from '../bethesda/espReader.js';
import { Ba2Reader } from '../bethesda/ba2Reader.js';
import { parseStringsBuffer, stringsTypeFromPath } from '../bethesda/stringsFile.js';
import { parseMcmBuffer, mcmLocaleFromPath } from '../bethesda/mcmReader.js';
import { parsePexBuffer } from '../bethesda/pexReader.js';
import type { CsvRow } from '../types.js';

const BATCH_SIZE = 1000;

// ── Types ───────────────────────────────────────────────────────────────────

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
  esp_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface ModPreviewRow {
  formId: string;
  signature: string;
  edid: string;
  path: string;
  source: string;
}

export type ProgressCb = (imported: number, total: number) => void;

// ── Schema ──────────────────────────────────────────────────────────────────

export const ensureModImportSchema = async (_db: Tx) => {
  // Schema is now managed by sql/schema.sql — no-op
}

// ── CRUD helpers ────────────────────────────────────────────────────────────

export const listModImportJobs = async (db: Tx): Promise<ModImportJob[]> => {
  const { rows } = await db.query('SELECT * FROM mod_imports ORDER BY created_at DESC');
  return rows as ModImportJob[];
}

export const getModImportJob = async (db: Tx, id: number): Promise<ModImportJob | undefined> => {
  const { rows } = await db.query('SELECT * FROM mod_imports WHERE id = $1', [id]);
  return rows[0] as ModImportJob | undefined;
}

export const updateModJobLanguages = async (db: Tx, id: number, srcLang: string, tgtLang: string) => {
  await db.query(
    `UPDATE mod_imports SET src_lang = $1, tgt_lang = $2, updated_at = NOW() WHERE id = $3`,
    [srcLang, tgtLang, id],
  );
}

export const deleteModImportJob = async (db: Tx, id: number) => {
  await db.query('DELETE FROM mod_imports WHERE id = $1', [id]);
}

// ── Archive extraction ──────────────────────────────────────────────────────

const ARCHIVE_EXTS = new Set(['.zip', '.7z', '.rar']);
const PLUGIN_EXTS = new Set(['.esp', '.esm', '.esl']);

export const isArchive = (fileName: string): boolean => {
  return ARCHIVE_EXTS.has(path.extname(fileName).toLowerCase());
}

export const isPlugin = (fileName: string): boolean => {
  return PLUGIN_EXTS.has(path.extname(fileName).toLowerCase());
}

/** Extract archive to a directory using 7-zip. Returns the output directory. */
export const extractArchive = (archivePath: string, outDir: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const stream = Seven.extractFull(archivePath, outDir, {
      $bin: path7za,
      yes: true,
      recursive: true,
    });
    stream.on('end', () => resolve());
    stream.on('error', (err: Error) => reject(err));
  });
}

/**
 * Discover ESP/ESL/ESM + BA2 files inside a directory (recursive).
 */
export const discoverModFiles = (dir: string): { plugins: string[]; ba2s: string[] } => {
  const plugins: string[] = [];
  const ba2s: string[] = [];

  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      const ext = path.extname(entry.name).toLowerCase();
      if (PLUGIN_EXTS.has(ext)) plugins.push(full);
      else if (ext === '.ba2') ba2s.push(full);
    }
  }
  walk(dir);
  return { plugins, ba2s };
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

export const registerPluginFile = async (
  db: Tx,
  fileName: string,
  pluginPath: string,
  srcLang: string,
  tgtLang: string,
): Promise<ModImportJob> => {
  const buf = fs.readFileSync(pluginPath);
  const fileHash = sha1Hex(buf);

  const { rows: existing } = await db.query('SELECT * FROM mod_imports WHERE file_hash = $1', [fileHash]);
  if (existing[0]) return existing[0] as ModImportJob;

  const esp = new EspReader(pluginPath);
  const espRows = esp.extractStrings();
  const isLocalized = esp.info.isLocalized ? 1 : 0;

  const modName = fileName.replace(/\.(esp|esm|esl)$/i, '');
  const modId = await upsertMod(db, modName, pluginPath, fileHash);

  const totalRecords = espRows.length;

  await db.query(
    `INSERT INTO mod_imports(file_name, file_hash, mod_id, total_records, status, src_lang, tgt_lang, is_localized, esp_path)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)`,
    [fileName, fileHash, modId, totalRecords, srcLang, tgtLang, isLocalized, pluginPath],
  );

  const { rows } = await db.query('SELECT * FROM mod_imports WHERE file_hash = $1', [fileHash]);
  return rows[0] as ModImportJob;
}

export const registerArchiveFile = async (
  db: Tx,
  fileName: string,
  archivePath: string,
  extractDir: string,
  srcLang: string,
  tgtLang: string,
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
  const esp = new EspReader(pluginPath);
  const espRows = esp.extractStrings();
  const isLocalized = esp.info.isLocalized ? 1 : 0;

  const modName = fileName.replace(/\.(zip|7z|rar)$/i, '');
  const modId = await upsertMod(db, modName, pluginPath, fileHash);

  const totalRecords = espRows.length;

  await db.query(
    `INSERT INTO mod_imports(file_name, file_hash, mod_id, total_records, status, src_lang, tgt_lang, is_localized, esp_path)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)`,
    [fileName, fileHash, modId, totalRecords, srcLang, tgtLang, isLocalized, pluginPath],
  );

  const { rows } = await db.query('SELECT * FROM mod_imports WHERE file_hash = $1', [fileHash]);
  return rows[0] as ModImportJob;
}

// ── Preview ─────────────────────────────────────────────────────────────────

export const previewModRecords = (job: ModImportJob, ba2Candidates: string[] = []): {
  rows: ModPreviewRow[];
  locales: string[];
  isLocalized: boolean;
} => {
  const espPath = job.esp_path;
  if (!espPath || !fs.existsSync(espPath)) throw new Error('Plugin file not found on disk');

  const esp = new EspReader(espPath);
  const espRows = esp.extractStrings();

  let localesMap = new Map<string, Map<number, string>>();
  if (esp.info.isLocalized) {
    const ba2Path = discoverBa2(espPath, ba2Candidates);
    if (ba2Path) {
      localesMap = loadLocalesFromBA2(ba2Path);
    } else {
      localesMap = loadLocalesFromLooseFiles(espPath);
    }
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

export const isModImportRunning = (jobId: number): boolean => {
  return activeImports.has(jobId);
}

export const requestModCancel = (jobId: number) => {
  const state = activeImports.get(jobId);
  if (state) state.cancel = true;
}

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
    const esp = new EspReader(espPath);
    const espRows = esp.extractStrings();

    let imported = job.imported_records;
    let batchCount = 0;
    let inTx = false;

    if (esp.info.isLocalized) {
      const ba2Path = discoverBa2(espPath, []);
      let localesMap: Map<string, Map<number, string>>;
      if (ba2Path) {
        localesMap = loadLocalesFromBA2(ba2Path);
      } else {
        localesMap = loadLocalesFromLooseFiles(espPath);
      }
      if (localesMap.size === 0) throw new Error('No locales found in BA2 / strings files');

      const work: { locale: string; rows: CsvRow[] }[] = [];
      for (const [locale, strMap] of localesMap) {
        work.push({ locale, rows: buildCsvRows(espRows, strMap) });
      }
      const totalAll = work.reduce((s, w) => s + w.rows.length, 0);
      await db.query('UPDATE mod_imports SET total_records = $1 WHERE id = $2', [totalAll, job.id]);

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
          const recordId = await upsertRecord(db, job.mod_id!, r.Signature, r.Path, pathSimplified, r.EDID ?? null, hashNorm, r.FormID || null);
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
        const recordId = await upsertRecord(db, job.mod_id!, r.Signature, r.Path, pathSimplified, r.EDID ?? null, hashNorm, r.FormID || null);
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
            const recordId = await upsertRecord(db, job.mod_id!, r.Signature, r.Path, r.PathSimplified ?? r.Path, null, hashNorm, '');
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
            const recordId = await upsertRecord(db, job.mod_id!, r.Signature, r.Path, r.PathSimplified ?? r.Path, null, hashNorm, '');
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

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
import { normalizeForHash } from '../utils/textNorm.js';
import { log } from '../logger.js';
import { EspReader, type EspStringRow } from '../bethesda/espReader.js';
import { Ba2Reader } from '../bethesda/ba2Reader.js';
import { parseStringsBuffer, stringsTypeFromPath } from '../bethesda/stringsFile.js';
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

export async function ensureModImportSchema(_db: Tx) {
  // Schema is now managed by sql/schema.sql — no-op
}

// ── CRUD helpers ────────────────────────────────────────────────────────────

export async function listModImportJobs(db: Tx): Promise<ModImportJob[]> {
  const { rows } = await db.query('SELECT * FROM mod_imports ORDER BY created_at DESC');
  return rows as ModImportJob[];
}

export async function getModImportJob(db: Tx, id: number): Promise<ModImportJob | undefined> {
  const { rows } = await db.query('SELECT * FROM mod_imports WHERE id = $1', [id]);
  return rows[0] as ModImportJob | undefined;
}

export async function updateModJobLanguages(db: Tx, id: number, srcLang: string, tgtLang: string) {
  await db.query(
    `UPDATE mod_imports SET src_lang = $1, tgt_lang = $2, updated_at = NOW() WHERE id = $3`,
    [srcLang, tgtLang, id],
  );
}

export async function deleteModImportJob(db: Tx, id: number) {
  await db.query('DELETE FROM mod_imports WHERE id = $1', [id]);
}

// ── Archive extraction ──────────────────────────────────────────────────────

const ARCHIVE_EXTS = new Set(['.zip', '.7z', '.rar']);
const PLUGIN_EXTS = new Set(['.esp', '.esm', '.esl']);

export function isArchive(fileName: string): boolean {
  return ARCHIVE_EXTS.has(path.extname(fileName).toLowerCase());
}

export function isPlugin(fileName: string): boolean {
  return PLUGIN_EXTS.has(path.extname(fileName).toLowerCase());
}

/** Extract archive to a directory using 7-zip. Returns the output directory. */
export function extractArchive(archivePath: string, outDir: string): Promise<void> {
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
export function discoverModFiles(dir: string): { plugins: string[]; ba2s: string[] } {
  const plugins: string[] = [];
  const ba2s: string[] = [];

  function walk(d: string) {
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

function discoverBa2(modPath: string, ba2Candidates: string[]): string | null {
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

function loadLocalesFromBA2(ba2Path: string): Map<string, Map<number, string>> {
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

function loadLocalesFromLooseFiles(modPath: string): Map<string, Map<number, string>> {
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

function buildCsvRows(
  espRows: EspStringRow[],
  stringsMap: Map<number, string> | null,
): CsvRow[] {
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
      Source: text,
    });
  }
  return rows;
}

// ── Registration ────────────────────────────────────────────────────────────

export async function registerPluginFile(
  db: Tx,
  fileName: string,
  pluginPath: string,
  srcLang: string,
  tgtLang: string,
): Promise<ModImportJob> {
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

export async function registerArchiveFile(
  db: Tx,
  fileName: string,
  archivePath: string,
  extractDir: string,
  srcLang: string,
  tgtLang: string,
): Promise<ModImportJob> {
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

export function previewModRecords(job: ModImportJob, ba2Candidates: string[] = []): {
  rows: ModPreviewRow[];
  locales: string[];
  isLocalized: boolean;
} {
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

export function isModImportRunning(jobId: number): boolean {
  return activeImports.has(jobId);
}

export function requestModCancel(jobId: number) {
  const state = activeImports.get(jobId);
  if (state) state.cancel = true;
}

export function requestModPause(jobId: number) {
  const state = activeImports.get(jobId);
  if (state) state.pause = true;
}

// ── Import execution ────────────────────────────────────────────────────────

async function updateProgress(db: Tx, jobId: number, importedRecords: number) {
  await db.query(
    `UPDATE mod_imports SET imported_records = $1, status = 'in_progress', updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
}

async function markDone(db: Tx, jobId: number, importedRecords: number) {
  await db.query(
    `UPDATE mod_imports SET status = 'completed', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
}

async function markFailed(db: Tx, jobId: number, importedRecords: number) {
  await db.query(
    `UPDATE mod_imports SET status = 'failed', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
}

async function markPaused(db: Tx, jobId: number, importedRecords: number) {
  await db.query(
    `UPDATE mod_imports SET status = 'paused', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
}

export async function runModImport(
  db: Tx,
  job: ModImportJob,
  onProgress?: ProgressCb,
): Promise<ModImportJob> {
  if (job.status === 'completed') return job;
  if (activeImports.has(job.id)) throw new Error(`Mod Import #${job.id} is already running`);

  const espPath = job.esp_path;
  if (!espPath || !fs.existsSync(espPath)) throw new Error('Plugin file not found');

  const state: ActiveImport = { cancel: false, pause: false };
  activeImports.set(job.id, state);

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
          await insertString(db, recordId, locale, r.Source, normalizeForHash(r.Source), 'mod-import');

          imported++;
          batchCount++;

          if (batchCount >= BATCH_SIZE) {
            await updateProgress(db, job.id, imported);
            await db.query('COMMIT');
            inTx = false;
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
        await insertString(db, recordId, job.src_lang, r.Source, normalizeForHash(r.Source), 'mod-import');

        imported++;
        batchCount++;

        if (batchCount >= BATCH_SIZE) {
          await updateProgress(db, job.id, imported);
          await db.query('COMMIT');
          inTx = false;
          onProgress?.(imported, csvRows.length);
        }
      }
    }

    if (inTx) { await db.query('COMMIT'); inTx = false; }

    if (!state.cancel && !state.pause) {
      await markDone(db, job.id, imported);
      onProgress?.(imported, job.total_records);
    }
  } catch (err) {
    await markFailed(db, job.id, job.imported_records);
    throw err;
  } finally {
    activeImports.delete(job.id);
  }

  return (await getModImportJob(db, job.id))!;
}

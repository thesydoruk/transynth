/**
 * CSV import service — reusable import engine for both CLI and web routes.
 * Mirrors eetImportService but reads CSV files instead of binary EET.
 * Supports pause, cancel, resume and progress callbacks.
 */
import { upsertMod, upsertRecord, insertString, addTranslation, type Tx } from '../db.js';
import { sha1Hex } from '../utils/hash.js';
import { normalizeForHash } from '../utils/textNorm.js';
import { parseCsvLine } from '../utils/csv.js';
import { log } from '../logger.js';

const BATCH_SIZE = 1000;

export interface CsvImportJob {
  id: number;
  file_name: string;
  file_hash: string;
  mod_id: number | null;
  total_records: number;
  imported_records: number;
  status: string;
  src_lang: string;
  tgt_lang: string;
  created_at: string;
  updated_at: string;
}

export interface CsvRecord {
  formId: string;
  signature: string;
  edid: string;
  field: string;
  source: string;
  target: string;
  status: number;
}

export type ProgressCb = (imported: number, total: number) => void;

// ── Schema ──────────────────────────────────────────────────────────────────

export function ensureCsvImportSchema(db: Tx) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS csv_imports (
      id INTEGER PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      mod_id INTEGER REFERENCES mods(id) ON DELETE SET NULL,
      total_records INTEGER NOT NULL DEFAULT 0,
      imported_records INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      src_lang TEXT NOT NULL DEFAULT 'en',
      tgt_lang TEXT NOT NULL DEFAULT 'uk',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(file_hash)
    );
  `);
}

// ── CRUD helpers ────────────────────────────────────────────────────────────

export function listCsvImportJobs(db: Tx): CsvImportJob[] {
  return db.prepare('SELECT * FROM csv_imports ORDER BY created_at DESC').all() as CsvImportJob[];
}

export function getCsvImportJob(db: Tx, id: number): CsvImportJob | undefined {
  return db.prepare('SELECT * FROM csv_imports WHERE id = ?').get(id) as CsvImportJob | undefined;
}

export function updateCsvJobLanguages(db: Tx, id: number, srcLang: string, tgtLang: string) {
  db.prepare(
    `UPDATE csv_imports SET src_lang = ?, tgt_lang = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).run(srcLang, tgtLang, id);
}

export function deleteCsvImportJob(db: Tx, id: number) {
  db.prepare('DELETE FROM csv_imports WHERE id = ?').run(id);
}

function getOrCreateJob(
  db: Tx, fileName: string, fileHash: string, modId: number,
  totalRecords: number, srcLang: string, tgtLang: string,
): CsvImportJob {
  const existing = db.prepare('SELECT * FROM csv_imports WHERE file_hash = ?').get(fileHash) as CsvImportJob | undefined;
  if (existing) return existing;

  db.prepare(
    `INSERT INTO csv_imports(file_name, file_hash, mod_id, total_records, status, src_lang, tgt_lang)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(fileName, fileHash, modId, totalRecords, srcLang, tgtLang);

  return db.prepare('SELECT * FROM csv_imports WHERE file_hash = ?').get(fileHash) as CsvImportJob;
}

function updateProgress(db: Tx, jobId: number, importedRecords: number) {
  db.prepare(
    `UPDATE csv_imports SET imported_records = ?, status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).run(importedRecords, jobId);
}

function markDone(db: Tx, jobId: number, importedRecords: number) {
  db.prepare(
    `UPDATE csv_imports SET status = 'completed', imported_records = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).run(importedRecords, jobId);
}

function markFailed(db: Tx, jobId: number, importedRecords: number) {
  db.prepare(
    `UPDATE csv_imports SET status = 'failed', imported_records = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).run(importedRecords, jobId);
}

function markPaused(db: Tx, jobId: number, importedRecords: number) {
  db.prepare(
    `UPDATE csv_imports SET status = 'paused', imported_records = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).run(importedRecords, jobId);
}

// ── CSV parsing ─────────────────────────────────────────────────────────────

/** Parse CSV text into structured records. */
export function parseCsvRecords(text: string): CsvRecord[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];

  const headerLine = lines.shift()!;
  const cols = parseCsvLine(headerLine);
  const idx = (name: string) => cols.findIndex(c => c.toLowerCase() === name.toLowerCase());

  const iFormId = idx('FormID');
  const iSig = idx('Signature');
  const iEdid = idx('EDID');
  const iPath = idx('Path');
  const iSource = idx('Source');
  const iTarget = idx('Target');
  const iStatus = idx('Status');

  const records: CsvRecord[] = [];
  for (const line of lines) {
    const f = parseCsvLine(line);
    const statusRaw = iStatus >= 0 ? (f[iStatus] ?? '') : '';
    let statusByte = 0xFF;
    if (statusRaw === 'confirmed') statusByte = 0x63;
    else if (statusRaw === 'untranslated') statusByte = 0xFF;
    else if (/^\d+$/.test(statusRaw)) statusByte = Number(statusRaw);

    records.push({
      formId: iFormId >= 0 ? (f[iFormId] ?? '') : '',
      signature: iSig >= 0 ? (f[iSig] ?? '') : '',
      edid: iEdid >= 0 ? (f[iEdid] ?? '') : '',
      field: iPath >= 0 ? (f[iPath] ?? 'FULL') : 'FULL',
      source: iSource >= 0 ? (f[iSource] ?? '') : '',
      target: iTarget >= 0 ? (f[iTarget] ?? '') : '',
      status: statusByte,
    });
  }
  return records;
}

/** Iterate CSV records one at a time (for preview). */
export function* iterCsvRecords(text: string): Generator<CsvRecord> {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return;

  const headerLine = lines.shift()!;
  const cols = parseCsvLine(headerLine);
  const idx = (name: string) => cols.findIndex(c => c.toLowerCase() === name.toLowerCase());

  const iFormId = idx('FormID');
  const iSig = idx('Signature');
  const iEdid = idx('EDID');
  const iPath = idx('Path');
  const iSource = idx('Source');
  const iTarget = idx('Target');
  const iStatus = idx('Status');

  for (const line of lines) {
    const f = parseCsvLine(line);
    const statusRaw = iStatus >= 0 ? (f[iStatus] ?? '') : '';
    let statusByte = 0xFF;
    if (statusRaw === 'confirmed') statusByte = 0x63;
    else if (statusRaw === 'untranslated') statusByte = 0xFF;
    else if (/^\d+$/.test(statusRaw)) statusByte = Number(statusRaw);

    yield {
      formId: iFormId >= 0 ? (f[iFormId] ?? '') : '',
      signature: iSig >= 0 ? (f[iSig] ?? '') : '',
      edid: iEdid >= 0 ? (f[iEdid] ?? '') : '',
      field: iPath >= 0 ? (f[iPath] ?? 'FULL') : 'FULL',
      source: iSource >= 0 ? (f[iSource] ?? '') : '',
      target: iTarget >= 0 ? (f[iTarget] ?? '') : '',
      status: statusByte,
    };
  }
}

function importRecord(db: Tx, modId: number, rec: CsvRecord, srcLang: string, tgtLang: string) {
  const recPath = rec.field || 'FULL';
  const hashNorm = normalizeForHash(rec.source);
  const recordId = upsertRecord(db, modId, rec.signature, recPath, recPath, rec.edid || null, hashNorm, rec.formId || null);
  const srcNorm = normalizeForHash(rec.source);
  const srcStringId = insertString(db, recordId, srcLang, rec.source, srcNorm, 'csv');
  if (rec.target) {
    const status = rec.status === 0x63 ? 'human' : 'auto';
    addTranslation(db, srcStringId, tgtLang, rec.target, status, rec.status === 0x63 ? 1.0 : 0.5, 'csv');
  }
}

/** Register an uploaded CSV file (parse, create job). Returns the job. */
export function registerCsvFile(db: Tx, fileName: string, text: string, srcLang = 'en', tgtLang = 'uk'): CsvImportJob {
  const fileHash = sha1Hex(Buffer.from(text, 'utf8'));
  const records = parseCsvRecords(text);
  const totalRecords = records.length;

  const modName = fileName.replace(/\.csv$/i, '');
  const modId = upsertMod(db, modName, `csv-upload/${fileName}`, fileHash);

  return getOrCreateJob(db, fileName, fileHash, modId, totalRecords, srcLang, tgtLang);
}

// ── Active import tracking ──────────────────────────────────────────────────

interface ActiveImport {
  cancel: boolean;
  pause: boolean;
}

const activeImports = new Map<number, ActiveImport>();

export function isCsvImportRunning(jobId: number): boolean {
  return activeImports.has(jobId);
}

export function requestCsvCancel(jobId: number) {
  const state = activeImports.get(jobId);
  if (state) state.cancel = true;
}

export function requestCsvPause(jobId: number) {
  const state = activeImports.get(jobId);
  if (state) state.pause = true;
}

/**
 * Run CSV import for a single job. Reads the file text, resumes from last offset.
 * Calls onProgress after each batch.
 */
export function runCsvImport(
  db: Tx,
  job: CsvImportJob,
  text: string,
  onProgress?: ProgressCb,
): CsvImportJob {
  if (job.status === 'completed') return job;
  if (activeImports.has(job.id)) throw new Error(`CSV Import #${job.id} is already running`);

  const state: ActiveImport = { cancel: false, pause: false };
  activeImports.set(job.id, state);

  const records = parseCsvRecords(text);
  const skipCount = job.imported_records;
  let imported = job.imported_records;
  let batchCount = 0;
  let inTx = false;

  try {
    for (let i = 0; i < records.length; i++) {
      if (i < skipCount) continue;

      if (state.cancel) {
        if (inTx) { db.exec('COMMIT'); inTx = false; }
        markFailed(db, job.id, imported);
        log.info(`CSV Import #${job.id} cancelled at ${imported}/${job.total_records}`);
        break;
      }
      if (state.pause) {
        if (inTx) { db.exec('COMMIT'); inTx = false; }
        markPaused(db, job.id, imported);
        log.info(`CSV Import #${job.id} paused at ${imported}/${job.total_records}`);
        break;
      }

      if (!inTx) { db.exec('BEGIN'); inTx = true; batchCount = 0; }

      importRecord(db, job.mod_id!, records[i], job.src_lang, job.tgt_lang);
      imported++;
      batchCount++;

      if (batchCount >= BATCH_SIZE) {
        updateProgress(db, job.id, imported);
        db.exec('COMMIT');
        inTx = false;
        onProgress?.(imported, job.total_records);
      }
    }

    if (inTx) { db.exec('COMMIT'); inTx = false; }

    if (!state.cancel && !state.pause) {
      markDone(db, job.id, imported);
      onProgress?.(imported, job.total_records);
    }
  } catch (err) {
    if (inTx) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } }
    markFailed(db, job.id, imported);
    throw err;
  } finally {
    activeImports.delete(job.id);
  }

  return getCsvImportJob(db, job.id)!;
}

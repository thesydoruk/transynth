/**
 * EET import service — reusable import engine for both CLI and web routes.
 * Supports pause, cancel, resume and progress callbacks.
 */
import { parseEetHeader, iterEetRecords, type EetRecord } from '../bethesda/eetReader.js';
import { upsertMod, upsertRecord, insertString, addTranslation, type Tx } from '../db.js';
import { sha1Hex } from '../utils/hash.js';
import { normalizeForHash } from '../utils/textNorm.js';
import { log } from '../logger.js';

const BATCH_SIZE = 1000;

export interface ImportJob {
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

export type ProgressCb = (imported: number, total: number) => void;

export function ensureImportSchema(db: Tx) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS eet_imports (
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

export function listImportJobs(db: Tx): ImportJob[] {
  return db.prepare('SELECT * FROM eet_imports ORDER BY created_at DESC').all() as ImportJob[];
}

export function getImportJob(db: Tx, id: number): ImportJob | undefined {
  return db.prepare('SELECT * FROM eet_imports WHERE id = ?').get(id) as ImportJob | undefined;
}

export function updateJobLanguages(db: Tx, id: number, srcLang: string, tgtLang: string) {
  db.prepare(
    `UPDATE eet_imports SET src_lang = ?, tgt_lang = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(srcLang, tgtLang, id);
}

export function deleteImportJob(db: Tx, id: number) {
  db.prepare('DELETE FROM eet_imports WHERE id = ?').run(id);
}

function getOrCreateJob(db: Tx, fileName: string, fileHash: string, modId: number, totalRecords: number, srcLang: string, tgtLang: string): ImportJob {
  const existing = db.prepare('SELECT * FROM eet_imports WHERE file_hash = ?').get(fileHash) as ImportJob | undefined;
  if (existing) return existing;

  db.prepare(
    `INSERT INTO eet_imports(file_name, file_hash, mod_id, total_records, status, src_lang, tgt_lang)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`
  ).run(fileName, fileHash, modId, totalRecords, srcLang, tgtLang);

  return db.prepare('SELECT * FROM eet_imports WHERE file_hash = ?').get(fileHash) as ImportJob;
}

function updateProgress(db: Tx, jobId: number, importedRecords: number) {
  db.prepare(
    `UPDATE eet_imports SET imported_records = ?, status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(importedRecords, jobId);
}

function markDone(db: Tx, jobId: number, importedRecords: number) {
  db.prepare(
    `UPDATE eet_imports SET status = 'completed', imported_records = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(importedRecords, jobId);
}

function markFailed(db: Tx, jobId: number, importedRecords: number) {
  db.prepare(
    `UPDATE eet_imports SET status = 'failed', imported_records = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(importedRecords, jobId);
}

function markPaused(db: Tx, jobId: number, importedRecords: number) {
  db.prepare(
    `UPDATE eet_imports SET status = 'paused', imported_records = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(importedRecords, jobId);
}

function importRecord(db: Tx, modId: number, rec: EetRecord, srcLang: string, tgtLang: string) {
  const recPath = rec.field || 'FULL';
  const hashNorm = normalizeForHash(rec.source);
  const recordId = upsertRecord(db, modId, rec.signature, recPath, recPath, rec.edid || null, hashNorm, rec.formId || null);
  const srcNorm = normalizeForHash(rec.source);
  const srcStringId = insertString(db, recordId, srcLang, rec.source, srcNorm, 'eet');
  if (rec.target) {
    const status = rec.status === 0x63 ? 'human' : 'auto';
    addTranslation(db, srcStringId, tgtLang, rec.target, status, rec.status === 0x63 ? 1.0 : 0.5, 'eet');
  }
}

/** Register an uploaded EET file (parse header, create job). Returns the job. */
export function registerEetFile(db: Tx, fileName: string, buf: Buffer, srcLang = 'en', tgtLang = 'uk'): ImportJob {
  const fileHash = sha1Hex(buf);
  const header = parseEetHeader(buf);

  let totalRecords = header.declaredCount;
  if (totalRecords < 0) {
    let count = 0;
    for (const _ of iterEetRecords(buf, header.recordsOffset)) count++;
    totalRecords = count;
  }

  const modName = fileName.replace(/\.eet$/i, '');
  const modId = upsertMod(db, modName, `eet-upload/${fileName}`, fileHash);

  return getOrCreateJob(db, fileName, fileHash, modId, totalRecords, srcLang, tgtLang);
}

// ── Active import tracking ──────────────────────────────────────────────────

interface ActiveImport {
  cancel: boolean;
  pause: boolean;
}

const activeImports = new Map<number, ActiveImport>();

export function isImportRunning(jobId: number): boolean {
  return activeImports.has(jobId);
}

export function requestCancel(jobId: number) {
  const state = activeImports.get(jobId);
  if (state) state.cancel = true;
}

export function requestPause(jobId: number) {
  const state = activeImports.get(jobId);
  if (state) state.pause = true;
}

/**
 * Run the import for a single job. Reads the file buffer, resumes from last offset.
 * Calls onProgress after each batch.
 * Returns the final job state.
 */
export function runImport(
  db: Tx,
  job: ImportJob,
  buf: Buffer,
  onProgress?: ProgressCb,
): ImportJob {
  if (job.status === 'completed') return job;
  if (activeImports.has(job.id)) throw new Error(`Import #${job.id} is already running`);

  const state: ActiveImport = { cancel: false, pause: false };
  activeImports.set(job.id, state);

  const header = parseEetHeader(buf);
  const skipCount = job.imported_records;
  let processed = 0;
  let imported = job.imported_records;
  let batchCount = 0;
  let inTx = false;

  try {
    for (const rec of iterEetRecords(buf, header.recordsOffset)) {
      processed++;
      if (processed <= skipCount) continue;

      if (state.cancel) {
        if (inTx) { db.exec('COMMIT'); inTx = false; }
        markFailed(db, job.id, imported);
        log.info(`Import #${job.id} cancelled at ${imported}/${job.total_records}`);
        break;
      }
      if (state.pause) {
        if (inTx) { db.exec('COMMIT'); inTx = false; }
        markPaused(db, job.id, imported);
        log.info(`Import #${job.id} paused at ${imported}/${job.total_records}`);
        break;
      }

      if (!inTx) { db.exec('BEGIN'); inTx = true; batchCount = 0; }

      importRecord(db, job.mod_id!, rec, job.src_lang, job.tgt_lang);
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

  return getImportJob(db, job.id)!;
}

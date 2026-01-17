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

export const ensureCsvImportSchema = async (_db: Tx) => {
  // Schema is now managed by sql/schema.sql — no-op
}

// ── CRUD helpers ────────────────────────────────────────────────────────────

export const listCsvImportJobs = async (db: Tx): Promise<CsvImportJob[]> => {
  const { rows } = await db.query('SELECT * FROM csv_imports ORDER BY created_at DESC');
  return rows as CsvImportJob[];
}

export const getCsvImportJob = async (db: Tx, id: number): Promise<CsvImportJob | undefined> => {
  const { rows } = await db.query('SELECT * FROM csv_imports WHERE id = $1', [id]);
  return rows[0] as CsvImportJob | undefined;
}

export const updateCsvJobLanguages = async (db: Tx, id: number, srcLang: string, tgtLang: string) => {
  await db.query(
    `UPDATE csv_imports SET src_lang = $1, tgt_lang = $2, updated_at = NOW() WHERE id = $3`,
    [srcLang, tgtLang, id],
  );
}

export const deleteCsvImportJob = async (db: Tx, id: number) => {
  await db.query('DELETE FROM csv_imports WHERE id = $1', [id]);
}

const getOrCreateJob = async (
  db: Tx, fileName: string, fileHash: string, modId: number,
  totalRecords: number, srcLang: string, tgtLang: string,
): Promise<CsvImportJob> => {
  const { rows: existing } = await db.query('SELECT * FROM csv_imports WHERE file_hash = $1', [fileHash]);
  if (existing[0]) return existing[0] as CsvImportJob;

  await db.query(
    `INSERT INTO csv_imports(file_name, file_hash, mod_id, total_records, status, src_lang, tgt_lang)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6)`,
    [fileName, fileHash, modId, totalRecords, srcLang, tgtLang],
  );

  const { rows } = await db.query('SELECT * FROM csv_imports WHERE file_hash = $1', [fileHash]);
  return rows[0] as CsvImportJob;
}

const updateProgress = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE csv_imports SET imported_records = $1, status = 'in_progress', updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
}

const markDone = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE csv_imports SET status = 'completed', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
}

const markFailed = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE csv_imports SET status = 'failed', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
}

const markPaused = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE csv_imports SET status = 'paused', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
}

// ── CSV parsing ─────────────────────────────────────────────────────────────

/** Parse CSV text into structured records. */
export const parseCsvRecords = (text: string): CsvRecord[] => {
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
// eslint-disable-next-line func-style
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

const importRecord = async (db: Tx, modId: number, rec: CsvRecord, srcLang: string, tgtLang: string) => {
  const recPath = rec.field || 'FULL';
  const hashNorm = normalizeForHash(rec.source);
  const recordId = await upsertRecord(db, modId, rec.signature, recPath, recPath, rec.edid || null, hashNorm, rec.formId || null);
  const srcNorm = normalizeForHash(rec.source);
  const srcStringId = await insertString(db, recordId, srcLang, rec.source, srcNorm, 'csv');
  if (rec.target) {
    const status = rec.status === 0x63 ? 'human' : 'auto';
    await addTranslation(db, srcStringId, tgtLang, rec.target, status, rec.status === 0x63 ? 1.0 : 0.5, 'csv');
  }
}

/** Register an uploaded CSV file (parse, create job). Returns the job. */
export const registerCsvFile = async (db: Tx, fileName: string, text: string, srcLang = 'en', tgtLang = 'uk'): Promise<CsvImportJob> => {
  const fileHash = sha1Hex(Buffer.from(text, 'utf8'));
  const records = parseCsvRecords(text);
  const totalRecords = records.length;

  const modName = fileName.replace(/\.csv$/i, '');
  const modId = await upsertMod(db, modName, `csv-upload/${fileName}`, fileHash);

  return getOrCreateJob(db, fileName, fileHash, modId, totalRecords, srcLang, tgtLang);
}

// ── Active import tracking ──────────────────────────────────────────────────

interface ActiveImport {
  cancel: boolean;
  pause: boolean;
}

const activeImports = new Map<number, ActiveImport>();

export const isCsvImportRunning = (jobId: number): boolean => {
  return activeImports.has(jobId);
}

export const requestCsvCancel = (jobId: number) => {
  const state = activeImports.get(jobId);
  if (state) state.cancel = true;
}

export const requestCsvPause = (jobId: number) => {
  const state = activeImports.get(jobId);
  if (state) state.pause = true;
}

/**
 * Run CSV import for a single job. Reads the file text, resumes from last offset.
 * Calls onProgress after each batch.
 */
export const runCsvImport = async (
  db: Tx,
  job: CsvImportJob,
  text: string,
  onProgress?: ProgressCb,
): Promise<CsvImportJob> => {
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
        if (inTx) { await db.query('COMMIT'); inTx = false; }
        await markFailed(db, job.id, imported);
        log.info(`CSV Import #${job.id} cancelled at ${imported}/${job.total_records}`);
        break;
      }
      if (state.pause) {
        if (inTx) { await db.query('COMMIT'); inTx = false; }
        await markPaused(db, job.id, imported);
        log.info(`CSV Import #${job.id} paused at ${imported}/${job.total_records}`);
        break;
      }

      if (!inTx) { await db.query('BEGIN'); inTx = true; batchCount = 0; }

      await importRecord(db, job.mod_id!, records[i], job.src_lang, job.tgt_lang);
      imported++;
      batchCount++;

      if (batchCount >= BATCH_SIZE) {
        await updateProgress(db, job.id, imported);
        await db.query('COMMIT');
        inTx = false;
        onProgress?.(imported, job.total_records);
      }
    }

    if (inTx) { await db.query('COMMIT'); inTx = false; }

    if (!state.cancel && !state.pause) {
      await markDone(db, job.id, imported);
      onProgress?.(imported, job.total_records);
    }
  } catch (err) {
    if (inTx) { try { await db.query('ROLLBACK'); } catch { /* ignore */ } }
    await markFailed(db, job.id, imported);
    throw err;
  } finally {
    activeImports.delete(job.id);
  }

  return (await getCsvImportJob(db, job.id))!;
}

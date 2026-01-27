/**
 * EET import service — reusable import engine for both CLI and web routes.
 * Supports pause, cancel, resume and progress callbacks.
 */
import pg from 'pg';
import { parseEetHeader, iterEetRecords, type EetRecord } from '../bethesda/eetReader.js';
import { upsertMod, upsertRecord, insertString, addTranslation, type Tx } from '../db.js';
import { sha1Hex } from '../utils/hash.js';
import { normalizeForHash, normalizeNoPunct } from '../utils/textNorm.js';
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

export const ensureImportSchema = async (_db: Tx) => {
  // Schema is now managed by sql/schema.sql — no-op
}

export const listImportJobs = async (db: Tx): Promise<ImportJob[]> => {
  const { rows } = await db.query('SELECT * FROM eet_imports ORDER BY created_at DESC');
  return rows as ImportJob[];
}

export const getImportJob = async (db: Tx, id: number): Promise<ImportJob | undefined> => {
  const { rows } = await db.query('SELECT * FROM eet_imports WHERE id = $1', [id]);
  return rows[0] as ImportJob | undefined;
}

export const updateJobLanguages = async (db: Tx, id: number, srcLang: string, tgtLang: string) => {
  await db.query(
    `UPDATE eet_imports SET src_lang = $1, tgt_lang = $2, updated_at = NOW() WHERE id = $3`,
    [srcLang, tgtLang, id],
  );
}

export const deleteImportJob = async (db: Tx, id: number) => {
  await db.query('DELETE FROM eet_imports WHERE id = $1', [id]);
}

const getOrCreateJob = async (db: Tx, fileName: string, fileHash: string, modId: number, totalRecords: number, srcLang: string, tgtLang: string): Promise<ImportJob> => {
  const { rows: existing } = await db.query('SELECT * FROM eet_imports WHERE file_hash = $1', [fileHash]);
  if (existing[0]) return existing[0] as ImportJob;

  await db.query(
    `INSERT INTO eet_imports(file_name, file_hash, mod_id, total_records, status, src_lang, tgt_lang)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6)`,
    [fileName, fileHash, modId, totalRecords, srcLang, tgtLang],
  );

  const { rows } = await db.query('SELECT * FROM eet_imports WHERE file_hash = $1', [fileHash]);
  return rows[0] as ImportJob;
}

const updateProgress = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE eet_imports SET imported_records = $1, status = 'in_progress', updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
}

const markDone = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE eet_imports SET status = 'completed', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
}

const markFailed = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE eet_imports SET status = 'failed', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
}

const markPaused = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE eet_imports SET status = 'paused', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
}

const importRecord = async (db: Tx, modId: number, rec: EetRecord, srcLang: string, tgtLang: string) => {
  const recPath = rec.field || 'FULL';
  const hashNorm = normalizeForHash(rec.source);
  const recordId = await upsertRecord(db, modId, rec.signature, recPath, recPath, rec.edid || null, hashNorm, rec.formId || null);
  const srcNorm = normalizeForHash(rec.source);
  const srcStringId = await insertString(db, recordId, srcLang, rec.source, srcNorm, 'eet', undefined, normalizeNoPunct(rec.source));
  if (rec.target) {
    const status = rec.status === 0x63 ? 'human' : 'auto';
    await addTranslation(db, srcStringId, tgtLang, rec.target, status, rec.status === 0x63 ? 1.0 : 0.5, 'eet');
  }
}

/** Register an uploaded EET file (parse header, create job). Returns the job. */
export const registerEetFile = async (db: Tx, fileName: string, buf: Buffer, srcLang = 'en', tgtLang = 'uk'): Promise<ImportJob> => {
  const fileHash = sha1Hex(buf);
  const header = parseEetHeader(buf);

  let totalRecords = header.declaredCount;
  if (totalRecords < 0) {
    let count = 0;
    for (const _ of iterEetRecords(buf, header.recordsOffset)) count++;
    totalRecords = count;
  }

  const modName = fileName.replace(/\.eet$/i, '');
  const modId = await upsertMod(db, modName, `eet-upload/${fileName}`, fileHash);

  return getOrCreateJob(db, fileName, fileHash, modId, totalRecords, srcLang, tgtLang);
}

// ── Active import tracking ──────────────────────────────────────────────────

interface ActiveImport {
  cancel: boolean;
  pause: boolean;
}

const activeImports = new Map<number, ActiveImport>();

export const isImportRunning = (jobId: number): boolean => {
  return activeImports.has(jobId);
}

export const requestCancel = (jobId: number) => {
  const state = activeImports.get(jobId);
  if (state) state.cancel = true;
}

export const requestPause = (jobId: number) => {
  const state = activeImports.get(jobId);
  if (state) state.pause = true;
}

/**
 * Run the import for a single job. Reads the file buffer, resumes from last offset.
 * Calls onProgress after each batch.
 *
 * IMPORTANT: Accepts a pg.Pool and acquires a **dedicated PoolClient** internally
 * so that BEGIN / COMMIT / ROLLBACK always hit the same Postgres connection.
 * Using pool.query('BEGIN') scatters transaction statements across random clients
 * and causes row-lock deadlocks — the classic node-pg anti-pattern.
 *
 * Returns the final job state.
 */
export const runImport = async (
  pool: pg.Pool,
  job: ImportJob,
  buf: Buffer,
  onProgress?: ProgressCb,
): Promise<ImportJob> => {
  if (job.status === 'completed') return job;
  if (activeImports.has(job.id)) throw new Error(`Import #${job.id} is already running`);

  const state: ActiveImport = { cancel: false, pause: false };
  activeImports.set(job.id, state);

  /* Acquire a dedicated client so BEGIN/COMMIT always target the same connection. */
  const client = await pool.connect();

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
        if (inTx) { await client.query('COMMIT'); inTx = false; }
        await markFailed(client, job.id, imported);
        log.info(`Import #${job.id} cancelled at ${imported}/${job.total_records}`);
        break;
      }
      if (state.pause) {
        if (inTx) { await client.query('COMMIT'); inTx = false; }
        await markPaused(client, job.id, imported);
        log.info(`Import #${job.id} paused at ${imported}/${job.total_records}`);
        break;
      }

      if (!inTx) { await client.query('BEGIN'); inTx = true; batchCount = 0; }

      await importRecord(client, job.mod_id!, rec, job.src_lang, job.tgt_lang);
      imported++;
      batchCount++;

      if (batchCount >= BATCH_SIZE) {
        await updateProgress(client, job.id, imported);
        await client.query('COMMIT');
        inTx = false;
        onProgress?.(imported, job.total_records);
      }
    }

    if (inTx) { await client.query('COMMIT'); inTx = false; }

    if (!state.cancel && !state.pause) {
      await markDone(client, job.id, imported);
      onProgress?.(imported, job.total_records);
    }
  } catch (err) {
    if (inTx) { try { await client.query('ROLLBACK'); } catch { /* ignore */ } }
    await markFailed(client, job.id, imported);
    throw err;
  } finally {
    client.release();
    activeImports.delete(job.id);
  }

  return (await getImportJob(pool, job.id))!;
}

/**
 * eetImportService.ts
 *
 * EET import pipeline used by the web UI.
 *
 * EET files are produced by ESP-ESM Translator and contain per-record source
 * and target strings. This module ingests them into PostgreSQL:
 * - creates/updates a mod row (identified by file hash),
 * - upserts record rows,
 * - inserts source strings in `src_lang`,
 * - and inserts target translations in `tgt_lang` when present.
 *
 * The import is resumable via the `eet_imports` job table and supports
 * pause/cancel requests between batches.
 *
 * IMPORTANT: {@link runImport} acquires a dedicated `pg.PoolClient` so that
 * transaction statements are executed on the same connection.
 */
import pg from 'pg';
import { parseEetHeader, iterEetRecords, type EetRecord } from '../bethesda/EetReader';
import { upsertMod, upsertRecord, insertString, addTranslation, type Tx } from '../db';
import { sha1Hex } from '../utils/hash';
import { normalizeForHash, normalizeNoPunct } from '../utils/textNorm';
import { log } from '../logger';

const BATCH_SIZE = 1000;

/**
 * Import job row stored in the `eet_imports` table.
 *
 * Jobs are keyed by the file hash so re-uploading the same file resumes the
 * existing job instead of creating duplicates.
 */
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
  last_error: string | null;
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

const markFailed = async (db: Tx, jobId: number, importedRecords: number, errorMsg?: string) => {
  await db.query(
    `UPDATE eet_imports SET status = 'failed', imported_records = $1, last_error = $2, updated_at = NOW() WHERE id = $3`,
    [importedRecords, errorMsg ?? null, jobId],
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

/**
 * Register an uploaded EET file by creating (or reusing) an import job row.
 *
 * This does not perform the import. Call {@link runImport} to execute the
 * actual ingestion.
 *
 * @param db - Database handle.
 * @param fileName - Original uploaded file name (used for display/mod naming).
 * @param buf - Raw EET file contents.
 * @param srcLang - Source language code for ingested strings.
 * @param tgtLang - Target language code for ingested translations.
 * @returns Created or existing job descriptor.
 */
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
/**
 * Execute an EET import job.
 *
 * The import resumes from `job.imported_records`. Progress is committed in
 * batches; between batches the job can be paused or cancelled.
 *
 * A dedicated PoolClient is used to guarantee transaction integrity.
 *
 * @param pool - PostgreSQL connection pool.
 * @param job - Job row previously returned by {@link registerEetFile}.
 * @param buf - Raw EET file contents.
 * @param onProgress - Optional callback invoked after each committed batch.
 * @returns Final job state.
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
  const startTime = Date.now();

  log.info(`[EET Import #${job.id}] Starting import of "${job.file_name}" — ${job.total_records} records, resuming from ${skipCount}`);

  try {
    for (const rec of iterEetRecords(buf, header.recordsOffset)) {
      processed++;
      if (processed <= skipCount) continue;

      if (state.cancel) {
        if (inTx) { await client.query('COMMIT'); inTx = false; }
        await markFailed(client, job.id, imported, 'Cancelled by user');
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
        const pct = ((imported / job.total_records) * 100).toFixed(1);
        log.info(`[EET Import #${job.id}] Progress: ${imported}/${job.total_records} (${pct}%)`);
        onProgress?.(imported, job.total_records);
      }
    }

    if (inTx) { await client.query('COMMIT'); inTx = false; }

    if (!state.cancel && !state.pause) {
      await markDone(client, job.id, imported);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      log.info(`[EET Import #${job.id}] Completed: ${imported} records in ${elapsed}s`);
      onProgress?.(imported, job.total_records);
    }
  } catch (err) {
    if (inTx) { try { await client.query('ROLLBACK'); } catch { /* ignore */ } }
    const errMsg = err instanceof Error ? err.message : String(err);
    await markFailed(client, job.id, imported, errMsg);
    log.error(`[EET Import #${job.id}] Failed at ${imported}/${job.total_records}: ${errMsg}`);
    throw err;
  } finally {
    client.release();
    activeImports.delete(job.id);
  }

  return (await getImportJob(pool, job.id))!;
}

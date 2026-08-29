/**
 * EET ingestion loop (worker process only).
 *
 * Reads records from an uploaded EET buffer and writes them into
 * `records` / `strings` / `translations` in batches, resuming from
 * `job.imported_records` so a paused or crashed import can continue.
 */
import type pg from 'pg';
import { iterEetRecords, parseEetHeader, type EetRecord } from '../../../../../src/formats/eet';
import { log } from '../../../../../src/logger';
import { CONFIG } from '../../../../../src/config';
import { bulkInsertRecordImportRows } from '../../../../../src/import/bulk/recordImport';
import { withModImportWriteLock } from '../../../../../src/import/locks';
import {
  getImportJob,
  markDone,
  markFailed,
  markPaused,
  updateProgress,
  type ImportJob,
  type ProgressCb,
} from '../../../../../src/import/eet/jobs';

interface ActiveImport {
  cancel: boolean;
  pause: boolean;
}

/**
 * Cooperative cancel/pause flags keyed by `eet_imports.id`.
 *
 * The loop checks them between batches, so a request only takes effect once the
 * current batch has been committed — progress is never lost.
 */
const activeImports = new Map<number, ActiveImport>();

export const requestCancel = (jobId: number) => {
  const state = activeImports.get(jobId);
  if (state) state.cancel = true;
};

export const requestPause = (jobId: number) => {
  const state = activeImports.get(jobId);
  if (state) state.pause = true;
};

/**
 * Execute an EET import job and return its final state.
 *
 * IMPORTANT: takes a `pg.Pool` and acquires a **dedicated PoolClient** so that
 * BEGIN / COMMIT / ROLLBACK always hit the same Postgres connection. Issuing
 * them through the pool scatters them across random clients and causes row-lock
 * deadlocks — the classic node-pg anti-pattern.
 *
 * @param pool - PostgreSQL connection pool.
 * @param job - Job row previously created by `registerEetFile`.
 * @param buf - Raw EET file contents.
 * @param onProgress - Invoked after each committed batch.
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

  const client = await pool.connect();

  const header = parseEetHeader(buf);
  const skipCount = job.imported_records;
  const importBatchSize = CONFIG.dbChunkSize;
  let processed = 0;
  let imported = job.imported_records;
  let inTx = false;
  const pending: EetRecord[] = [];
  const startTime = Date.now();

  log.info(
    `[EET Import #${job.id}] Starting import of "${job.file_name}" — ${job.total_records} records, resuming from ${skipCount} (batch=${importBatchSize})`,
  );

  const flushPendingBatch = async () => {
    if (pending.length === 0) return;
    await bulkInsertRecordImportRows(client, job.mod_id!, pending, job.src_lang, job.tgt_lang, {
      sourceKind: 'eet',
      provenance: 'eet',
    });
    imported += pending.length;
    pending.length = 0;
  };

  const commitOpenTx = async () => {
    if (inTx) {
      await client.query('COMMIT');
      inTx = false;
    }
  };

  const flushInTx = async () => {
    if (pending.length === 0) return;
    if (!inTx) {
      await client.query('BEGIN');
      inTx = true;
    }
    await flushPendingBatch();
  };

  try {
    await withModImportWriteLock(client, async () => {
      for (const rec of iterEetRecords(buf, header.recordsOffset)) {
        processed++;
        if (processed <= skipCount) continue;

        if (state.cancel) {
          await flushInTx();
          await commitOpenTx();
          await markFailed(client, job.id, imported, 'Cancelled by user');
          log.info(`Import #${job.id} cancelled at ${imported}/${job.total_records}`);
          break;
        }
        if (state.pause) {
          await flushInTx();
          await commitOpenTx();
          await markPaused(client, job.id, imported);
          log.info(`Import #${job.id} paused at ${imported}/${job.total_records}`);
          break;
        }

        pending.push(rec);

        if (pending.length >= importBatchSize) {
          await client.query('BEGIN');
          inTx = true;
          await flushPendingBatch();
          await updateProgress(client, job.id, imported);
          await commitOpenTx();
          const pct = ((imported / job.total_records) * 100).toFixed(1);
          log.info(`[EET Import #${job.id}] Progress: ${imported}/${job.total_records} (${pct}%)`);
          onProgress?.(imported, job.total_records);
        }
      }

      if (!state.cancel && !state.pause) await flushInTx();

      await commitOpenTx();

      if (!state.cancel && !state.pause) {
        await markDone(client, job.id, imported);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        log.info(`[EET Import #${job.id}] Completed: ${imported} records in ${elapsed}s`);
        onProgress?.(imported, job.total_records);
      }
    });
  } catch (err) {
    if (inTx) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    await markFailed(client, job.id, imported, errMsg);
    log.error(`[EET Import #${job.id}] Failed at ${imported}/${job.total_records}: ${errMsg}`);
    throw err;
  } finally {
    client.release();
    activeImports.delete(job.id);
  }

  return (await getImportJob(pool, job.id))!;
};

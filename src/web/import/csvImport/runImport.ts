import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { CONFIG } from '../../../config';
import { bulkInsertRecordImportRows } from '../recordImportBulk';
import { withModImportWriteLock } from '../modImportLocks';
import { getCsvImportJob, markDone, markFailed, markPaused, updateProgress } from './jobs';
import { iterCsvRecords } from './parse';
import type { CsvImportJob, CsvRecord, ProgressCb } from './types';

interface ActiveImport {
  cancel: boolean;
  pause: boolean;
}

const activeImports = new Map<number, ActiveImport>();

export const isCsvImportRunning = (jobId: number): boolean => {
  const state = activeImports.get(jobId);
  return !!state && !state.cancel && !state.pause;
};

export const hasActiveCsvImport = (jobId: number): boolean => activeImports.has(jobId);

export const requestCsvCancel = (jobId: number) => {
  const state = activeImports.get(jobId);
  if (state) state.cancel = true;
};

export const requestCsvPause = (jobId: number) => {
  const state = activeImports.get(jobId);
  if (state) state.pause = true;
};

/**
 * Execute a CSV import job.
 *
 * The import resumes from `job.imported_records`. Progress is committed in
 * batches; between batches the job can be paused or cancelled.
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

  const skipCount = job.imported_records;
  const importBatchSize = CONFIG.dbChunkSize;
  let processed = 0;
  let imported = job.imported_records;
  let inTx = false;
  const pending: CsvRecord[] = [];
  const startTime = Date.now();

  log.info(
    `[CSV Import #${job.id}] Starting import of "${job.file_name}" — ${job.total_records} records, resuming from ${skipCount} (batch=${importBatchSize})`,
  );

  const flushPendingBatch = async () => {
    if (pending.length === 0) return;
    await bulkInsertRecordImportRows(db, job.mod_id!, pending, job.src_lang, job.tgt_lang, {
      sourceKind: 'csv',
      provenance: 'csv',
    });
    imported += pending.length;
    pending.length = 0;
  };

  const commitOpenTx = async () => {
    if (inTx) {
      await db.query('COMMIT');
      inTx = false;
    }
  };

  try {
    await withModImportWriteLock(db, async () => {
      for (const rec of iterCsvRecords(text)) {
        processed++;
        if (processed <= skipCount) continue;

        if (state.cancel) {
          if (pending.length > 0) {
            if (!inTx) {
              await db.query('BEGIN');
              inTx = true;
            }
            await flushPendingBatch();
          }
          await commitOpenTx();
          await markFailed(db, job.id, imported);
          log.info(`CSV Import #${job.id} cancelled at ${imported}/${job.total_records}`);
          break;
        }
        if (state.pause) {
          if (pending.length > 0) {
            if (!inTx) {
              await db.query('BEGIN');
              inTx = true;
            }
            await flushPendingBatch();
          }
          await commitOpenTx();
          await markPaused(db, job.id, imported);
          log.info(`CSV Import #${job.id} paused at ${imported}/${job.total_records}`);
          break;
        }

        pending.push(rec);

        if (pending.length >= importBatchSize) {
          await db.query('BEGIN');
          inTx = true;
          await flushPendingBatch();
          await updateProgress(db, job.id, imported);
          await commitOpenTx();
          const pct = ((imported / job.total_records) * 100).toFixed(1);
          log.info(`[CSV Import #${job.id}] Progress: ${imported}/${job.total_records} (${pct}%)`);
          onProgress?.(imported, job.total_records);
        }
      }

      if (!state.cancel && !state.pause && pending.length > 0) {
        if (!inTx) {
          await db.query('BEGIN');
          inTx = true;
        }
        await flushPendingBatch();
      }

      await commitOpenTx();

      if (!state.cancel && !state.pause) {
        await markDone(db, job.id, imported);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        log.info(`[CSV Import #${job.id}] Completed: ${imported} records in ${elapsed}s`);
        onProgress?.(imported, job.total_records);
      }
    });
  } catch (err) {
    if (inTx) {
      try {
        await db.query('ROLLBACK');
      } catch {
        /* ignore */
      }
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error(`[CSV Import #${job.id}] Failed at ${imported}/${job.total_records}: ${errMsg}`);
    await markFailed(db, job.id, imported);
    throw err;
  } finally {
    activeImports.delete(job.id);
  }

  return (await getCsvImportJob(db, job.id))!;
};

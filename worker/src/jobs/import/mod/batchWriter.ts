/**
 * Batching write buffer for imported rows.
 *
 * Accumulates rows up to `CONFIG.dbChunkSize`, then writes them plus the dialog
 * graph in one transaction and commits progress. Deadlocks are retried, since
 * two importers touching overlapping records is expected rather than fatal.
 */
import type { Tx } from '../../../../../src/db';
import { CONFIG } from '../../../../../src/config';
import { logImport } from '../../../../../src/logging/loggers';
import {
  bulkInsertModImportRows,
  bulkUpsertDialogGraphForImportBatch,
  type ModImportBulkResult,
  type ModImportBulkRow,
  type DialogGraphImportContext,
} from '../../../../../src/import/bulk';
import { isPgDeadlockError } from '../../../../../src/import/locks';
import type { ProgressCb } from '../../../../../src/import/mod/types';
import { updateProgress } from '../../../../../src/import/mod/jobStatus';

export type ModImportBatchWriter = {
  pushImportRow: (row: ModImportBulkRow) => Promise<void>;
  flushPendingImportBatch: () => Promise<void>;
  discardOpenImportBatch: () => Promise<void>;
  commitOpenTx: () => Promise<void>;
};

export const createModImportBatchWriter = (opts: {
  db: Tx;
  jobId: number;
  importModId: number;
  importBatchSize: number;
  progressEvery: number;
  progressTotal: number;
  dialogGraphCtx: DialogGraphImportContext;
  trackImportBatch: (results: ModImportBulkResult[]) => void;
  onProgress?: ProgressCb;
  getImported: () => number;
  setImported: (value: number) => void;
  shouldStop?: () => boolean;
}): ModImportBatchWriter => {
  const pendingRows: ModImportBulkRow[] = [];
  let inTx = false;

  const flushPendingImportBatch = async (): Promise<void> => {
    if (pendingRows.length === 0) return;
    if (opts.shouldStop?.()) {
      pendingRows.length = 0;
      if (inTx) {
        await opts.db.query('ROLLBACK');
        inTx = false;
      }
      return;
    }
    const batch = pendingRows.splice(0, pendingRows.length);
    const maxAttempts = 4;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const results = await bulkInsertModImportRows(opts.db, opts.importModId, batch);
        opts.trackImportBatch(results);
        await bulkUpsertDialogGraphForImportBatch(
          opts.db,
          opts.importModId,
          results,
          opts.dialogGraphCtx,
        );
        opts.setImported(opts.getImported() + results.length);
        await updateProgress(opts.db, opts.jobId, opts.getImported());
        await opts.db.query('COMMIT');
        inTx = false;
        const imported = opts.getImported();
        if (
          opts.progressTotal > 0 &&
          (imported >= opts.progressTotal || imported % opts.progressEvery < batch.length)
        ) {
          const pct = ((imported / opts.progressTotal) * 100).toFixed(1);
          logImport.info(
            `[Mod Import #${opts.jobId}] Progress: ${imported}/${opts.progressTotal} (${pct}%)`,
          );
          opts.onProgress?.(imported, opts.progressTotal);
        }
        return;
      } catch (err) {
        if (inTx) {
          try {
            await opts.db.query('ROLLBACK');
          } catch {
            /* ignore */
          }
          inTx = false;
        }
        if (isPgDeadlockError(err) && attempt < maxAttempts) {
          logImport.warn(
            `[Mod Import #${opts.jobId}] Deadlock on batch (${batch.length} rows), retry ${attempt}/${maxAttempts - 1}`,
          );
          await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
          continue;
        }
        throw err;
      }
    }
  };

  const discardOpenImportBatch = async (): Promise<void> => {
    pendingRows.length = 0;
    if (inTx) {
      await opts.db.query('ROLLBACK');
      inTx = false;
    }
  };

  const pushImportRow = async (row: ModImportBulkRow): Promise<void> => {
    if (opts.shouldStop?.()) return;
    if (!inTx) {
      await opts.db.query('BEGIN');
      inTx = true;
    }
    pendingRows.push(row);
    if (pendingRows.length >= opts.importBatchSize) {
      if (opts.shouldStop?.()) {
        pendingRows.length = 0;
        if (inTx) {
          await opts.db.query('ROLLBACK');
          inTx = false;
        }
        return;
      }
      await flushPendingImportBatch();
    }
  };

  const commitOpenTx = async (): Promise<void> => {
    if (inTx) {
      await opts.db.query('COMMIT');
      inTx = false;
    }
  };

  return { pushImportRow, flushPendingImportBatch, discardOpenImportBatch, commitOpenTx };
};

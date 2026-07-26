/**
 * Parse and import a uploaded mod archive into `mod_imports` / string tables.
 *
 * Unlike AI handlers, progress events carry `jobId: importJobId` (the DB row),
 * not the BullMQ id — the import UI has always keyed off that. Cancel/pause
 * from the control channel flip cooperative flags inside the import loop
 * (process-local Maps keyed by `importJobId`).
 */
import {
  getModImportJob,
  requestModCancel,
  requestModPause,
  runModImport,
} from '../../../../src/web/import/modImport';
import type { JobHandler } from '../../types';

export type ModImportJobParams = {
  /** `mod_imports.id` — progress events carry this id, as the UI expects. */
  importJobId: number;
};

export const modImportHandler: JobHandler = async (db, ctx) => {
  const { importJobId } = ctx.data.params as ModImportJobParams;
  const job = await getModImportJob(db, importJobId);
  if (!job) throw new Error('Import job not found');

  // Wire BullMQ abort/pause onto the importer's cooperative flag Maps.
  ctx.signal.addEventListener('abort', () => requestModCancel(importJobId), { once: true });
  ctx.onPause(() => requestModPause(importJobId));

  const result = await runModImport(db, job, (imported, total) => {
    ctx.emit({ type: 'progress', imported, total, jobId: importJobId, done: imported });
  });

  ctx.emit({ type: 'done', job: { ...result, running: false } });
  ctx.mergeSnapshot({ importJobId, importStatus: result.status });

  return {
    status: ctx.isCancelled() ? 'cancelled' : 'completed',
    done: result.imported_records,
    total: result.total_records,
  };
};

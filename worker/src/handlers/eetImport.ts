/**
 * Import an EET workbook (`eet_imports` row + `.xlsx` on disk).
 *
 * Same cancel/pause and `jobId: importJobId` conventions as mod/CSV import —
 * see `modImport.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import {
  getImportJob,
  requestCancel,
  requestPause,
  runImport,
} from '../../../src/web/import/eetImportService';
import { PATHS } from '../../../src/paths';
import type { JobHandler } from '../types';

export type EetImportJobParams = {
  /** `eet_imports.id` — progress events carry this id, as the UI expects. */
  importJobId: number;
};

export const eetImportHandler: JobHandler = async (db, ctx) => {
  const { importJobId } = ctx.data.params as EetImportJobParams;
  const job = await getImportJob(db, importJobId);
  if (!job) throw new Error('Import job not found');

  const filePath = path.join(PATHS.eetUploads, path.basename(job.file_name));
  if (!fs.existsSync(filePath)) throw new Error('EET file not found on disk');
  const buf = fs.readFileSync(filePath);

  ctx.signal.addEventListener('abort', () => requestCancel(importJobId), { once: true });
  ctx.onPause(() => requestPause(importJobId));

  const result = await runImport(db as pg.Pool, job, buf, (imported, total) => {
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

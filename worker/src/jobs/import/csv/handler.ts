/**
 * Import strings from an uploaded CSV (`csv_imports` row + file on disk).
 *
 * Same cancel/pause and `jobId: importJobId` conventions as mod/EET import —
 * see `modImport.ts`. The file is read here so the importer stays pure I/O-free
 * beyond the DB write path.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getCsvImportJob } from '../../../../../src/import/csv';
import { PATHS } from '../../../../../src/paths';
import type { JobHandler } from '../../../types';
import { requestCsvCancel, requestCsvPause, runCsvImport } from './runImport';

export type CsvImportJobParams = {
  /** `csv_imports.id` — progress events carry this id, as the UI expects. */
  importJobId: number;
};

export const csvImportHandler: JobHandler = async (db, ctx) => {
  const { importJobId } = ctx.data.params as CsvImportJobParams;
  const job = await getCsvImportJob(db, importJobId);
  if (!job) throw new Error('Import job not found');

  const filePath = path.join(PATHS.csvUploads, path.basename(job.file_name));
  if (!fs.existsSync(filePath)) throw new Error('CSV file not found on disk');
  const text = fs.readFileSync(filePath, 'utf8');

  ctx.signal.addEventListener('abort', () => requestCsvCancel(importJobId), { once: true });
  ctx.onPause(() => requestCsvPause(importJobId));

  const result = await runCsvImport(db, job, text, (imported, total) => {
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

/**
 * Queue helpers for the mod / CSV / EET import routes.
 *
 * Import *rows* live in their own tables (`mod_imports`, `csv_imports`, …)
 * keyed by their own ids. A BullMQ job just wraps `params.importJobId`.
 * These helpers map that row id onto the queue entry so the UI can show
 * `running`, pause, and cancel without knowing the BullMQ id.
 */
import type { Job } from 'bullmq';
import { publishJobControl } from '../core/controlChannel';
import { listUnfinishedJobs, requestJobStop } from '../core/queue';
import type { JobData, JobKind } from '../types';

export type ImportJobKind = Extract<JobKind, 'mod-import' | 'csv-import' | 'eet-import'>;

const importJobIdOf = (job: Job<JobData>): number | null => {
  const value = (job.data.params as { importJobId?: unknown }).importJobId;
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
};

/** Import row ids that currently have a queued or running job. */
export const listQueuedImportIds = async (kind: ImportJobKind): Promise<Set<number>> => {
  const jobs = await listUnfinishedJobs([kind]);
  const ids = new Set<number>();
  for (const job of jobs) {
    const importJobId = importJobIdOf(job);
    if (importJobId != null) ids.add(importJobId);
  }
  return ids;
};

export const isImportQueued = async (kind: ImportJobKind, importJobId: number): Promise<boolean> =>
  (await listQueuedImportIds(kind)).has(importJobId);

const findQueuedImportJob = async (
  kind: ImportJobKind,
  importJobId: number,
): Promise<Job<JobData> | null> =>
  (await listUnfinishedJobs([kind])).find((job) => importJobIdOf(job) === importJobId) ?? null;

/** Cancel wherever the job is: removed if still queued, aborted if running. */
export const cancelQueuedImport = async (
  kind: ImportJobKind,
  importJobId: number,
): Promise<boolean> => {
  const job = await findQueuedImportJob(kind, importJobId);
  if (job?.id == null) return false;
  return requestJobStop(Number(job.id));
};

/** Pause is only meaningful once the worker is already running the import. */
export const pauseQueuedImport = async (
  kind: ImportJobKind,
  importJobId: number,
): Promise<boolean> => {
  const job = await findQueuedImportJob(kind, importJobId);
  if (job?.id == null) return false;
  await publishJobControl(Number(job.id), 'pause');
  return true;
};

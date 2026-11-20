/**
 * Pick up langpack exports the worker left behind.
 *
 * A deploy stops the worker in the middle of an export. The handler never
 * reaches its `finalizeExportArchive`, so the archive row stays `running`: the
 * UI shows it at 0/N for ever and every next export is refused with 409.
 * BullMQ notices only when the dead process's lock runs out and fails the job
 * as stalled.
 *
 * Two hooks close such an archive. When BullMQ fails the job, an export started
 * from the UI is enqueued again under a new job (an export is rebuilt from the
 * database, so a second run is safe) and an export that is a stage of a Vortex
 * run is failed with its run. On start the worker does the same for every
 * `running` archive whose job is gone or finished. An archive whose job is
 * still queued or active is left alone: BullMQ, or another worker, owns it.
 */
import type { Job } from 'bullmq';
import type { Tx } from '../../../src/db';
import { logJobs } from '../../../src/logging/loggers';
import {
  failRunningExportArchive,
  getExportArchive,
  listRunningExportArchives,
  moveExportArchiveToJob,
  type ExportArchiveRow,
} from '../../../src/web/data/queries/exportArchives';
import { removeExportArchiveFiles } from '../../../src/web/export/exportArchiveFiles';
import type { JobData } from '../types';
import { fromBullJobId } from './jobId';
import { allocateJobId, enqueueJob, getQueueJob } from './queue';
import { writeJobSnapshot } from './snapshots';

/** A third restart in a row means the export itself takes the worker down. */
export const MAX_EXPORT_RESTARTS = 2;

const STALL_FAIL = /stalled more than allowable limit/i;
const LIVE_STATES = new Set([
  'active',
  'waiting',
  'waiting-children',
  'delayed',
  'prioritized',
  'paused',
]);

export type RecoverExportsDeps = {
  getQueueJob?: typeof getQueueJob;
  allocateJobId?: typeof allocateJobId;
  enqueueJob?: typeof enqueueJob;
  writeSnapshot?: typeof writeJobSnapshot;
  removeFiles?: typeof removeExportArchiveFiles;
  log?: Pick<typeof logJobs, 'info' | 'warn'>;
};

export type ExportRecovery = 'restarted' | 'failed' | 'left';

const restartsOf = (data: JobData): number => {
  const raw = (data.params as { restarts?: unknown }).restarts;
  return typeof raw === 'number' && raw > 0 ? raw : 0;
};

const failArchive = async (
  db: Tx,
  archive: ExportArchiveRow,
  error: string,
  deps: RecoverExportsDeps,
): Promise<ExportRecovery> => {
  if (!(await failRunningExportArchive(db, archive.id, error))) return 'left';
  (deps.removeFiles ?? removeExportArchiveFiles)(archive.id);
  (deps.log ?? logJobs).warn('closed interrupted export', { archiveId: archive.id, error });
  return 'failed';
};

/** Start the export again under a new job, unless it keeps dying. */
const restartArchive = async (
  db: Tx,
  archive: ExportArchiveRow,
  oldJobId: number,
  data: JobData,
  deps: RecoverExportsDeps,
): Promise<ExportRecovery> => {
  const restarts = restartsOf(data);
  if (restarts >= MAX_EXPORT_RESTARTS) {
    const error = `export was cut short by a worker restart ${restarts + 1} times in a row`;
    return failArchive(db, archive, error, deps);
  }
  const jobId = await (deps.allocateJobId ?? allocateJobId)();
  // The row changes hands first: of two recoveries racing, only one enqueues.
  if (!(await moveExportArchiveToJob(db, archive.id, oldJobId, jobId))) return 'left';
  (deps.removeFiles ?? removeExportArchiveFiles)(archive.id);
  const next: JobData = { ...data, params: { ...data.params, restarts: restarts + 1 } };
  await (deps.writeSnapshot ?? writeJobSnapshot)({
    jobId,
    kind: next.kind,
    modId: next.modId,
    status: 'running',
    done: 0,
    total: 0,
    error: null,
    data: { jobId, modId: next.modId, archiveId: archive.id },
  });
  await (deps.enqueueJob ?? enqueueJob)(next, jobId);
  (deps.log ?? logJobs).warn('restarted interrupted export', {
    archiveId: archive.id,
    oldJobId,
    newJobId: jobId,
    restarts: restarts + 1,
  });
  return 'restarted';
};

/** On start: every `running` archive whose job BullMQ no longer runs. */
export const recoverInterruptedExports = async (
  db: Tx,
  deps: RecoverExportsDeps = {},
): Promise<number> => {
  const findJob = deps.getQueueJob ?? getQueueJob;
  let handled = 0;
  for (const archive of await listRunningExportArchives(db)) {
    const jobId = archive.job_id;
    const job = jobId != null ? await findJob(jobId) : undefined;
    const state = job ? await job.getState() : 'missing';
    if (LIVE_STATES.has(state)) continue;
    const stalledExport =
      job?.data.kind === 'langpack-export' && STALL_FAIL.test(job.failedReason ?? '');
    const outcome =
      job && jobId != null && stalledExport
        ? await restartArchive(db, archive, jobId, job.data, deps)
        : await failArchive(
            db,
            archive,
            `worker restarted during the export (job ${jobId ?? 'unknown'} ${state})`,
            deps,
          );
    if (outcome !== 'left') handled += 1;
  }
  return handled;
};

/**
 * BullMQ failed a job outside its handler: the archive it was writing learns why.
 * `isRunningHere` tells a dead worker's job from one whose handler still runs in
 * this process and only missed its lock renewal; that one finishes on its own.
 */
export const recoverExportForFailedJob = async (
  db: Tx,
  job: Job<JobData>,
  err: Error,
  isRunningHere: (jobId: number) => boolean,
  deps: RecoverExportsDeps = {},
): Promise<ExportRecovery> => {
  const { kind } = job.data;
  if (kind !== 'langpack-export' && kind !== 'vortex-sync') return 'left';
  const jobId = fromBullJobId(job.id);
  if (jobId == null || isRunningHere(jobId)) return 'left';

  if (kind === 'vortex-sync') {
    let outcome: ExportRecovery = 'left';
    for (const archive of await listRunningExportArchives(db)) {
      if (archive.job_id !== jobId) continue;
      outcome = await failArchive(db, archive, err.message, deps);
    }
    return outcome;
  }

  const archiveId = (job.data.params as { archiveId?: unknown }).archiveId;
  if (typeof archiveId !== 'number') return 'left';
  const archive = await getExportArchive(db, archiveId);
  if (!archive || archive.status !== 'running' || archive.job_id !== jobId) return 'left';
  return STALL_FAIL.test(err.message)
    ? restartArchive(db, archive, jobId, job.data, deps)
    : failArchive(db, archive, err.message, deps);
};

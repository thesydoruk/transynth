/**
 * Status / stop helpers for the per-kind job routes
 * (`GET /api/llm-verify/:jobId`, `POST /api/tm-apply/:jobId/stop`, …).
 *
 * Routes stay thin: validate params, call one of these, return JSON.
 */
import {
  fromBullJobId,
  getQueueJob,
  isIdleQueueState,
  listUnfinishedJobsForMod,
  removeIdleQueueJob,
  requestJobStop,
} from '../core/queue';
import { publishJobControl } from '../core/controlChannel';
import {
  isJobMarkedCancelled,
  markJobCancelled,
  readJobSnapshot,
  writeJobSnapshot,
} from '../core/snapshots';
import type { JobKind, JobSnapshot, JobSnapshotStatus } from '../types';

const markSnapshotCancelled = async (snapshot: JobSnapshot): Promise<void> => {
  if (snapshot.status !== 'running') return;
  await writeJobSnapshot({
    ...snapshot,
    status: 'cancelled',
    error: null,
  });
};

/**
 * Flatten a Redis snapshot into the JSON shape the frontend has always used:
 * handler fields (`rows`, `issues`, `applied`, …) at the top level together
 * with jobId / status / done / total / error.
 */
export const readJobStatus = async (
  jobId: number,
  kinds: readonly JobKind[],
): Promise<Record<string, unknown> | null> => {
  const snapshot = await readJobSnapshot(jobId);
  if (!snapshot || !kinds.includes(snapshot.kind)) return null;
  return {
    ...snapshot.data,
    jobId: snapshot.jobId,
    status: snapshot.status,
    done: snapshot.done,
    total: snapshot.total,
    error: snapshot.error,
  };
};

export type UnfinishedJobDisposition = 'block' | 'skip' | 'discard';

/**
 * Decide whether an unfinished BullMQ row still blocks a new start (409),
 * should be ignored (cancelled but still `active`), or dropped (waiting leftover).
 */
export const classifyUnfinishedJob = (opts: {
  snapshotStatus: JobSnapshotStatus | null;
  cancelledFlag: boolean;
  queueState: string;
}): UnfinishedJobDisposition => {
  const terminal =
    opts.cancelledFlag ||
    opts.snapshotStatus === 'cancelled' ||
    opts.snapshotStatus === 'completed' ||
    opts.snapshotStatus === 'failed';
  const idle = isIdleQueueState(opts.queueState);
  if (terminal) return idle ? 'discard' : 'skip';
  if (opts.snapshotStatus == null && idle) return 'discard';
  return 'block';
};

const stopUnfinishedJobsForMod = async (
  kinds: readonly JobKind[],
  modId: number,
  exceptJobId?: number,
): Promise<boolean> => {
  const jobs = await listUnfinishedJobsForMod(kinds, modId);
  let stopped = false;
  for (const job of jobs) {
    if (job.id == null) continue;
    const id = fromBullJobId(job.id);
    if (id == null || id === exceptJobId) continue;
    if (await requestJobStop(id)) stopped = true;
  }
  return stopped;
};

/** Stop by job id; refuse ids that belong to a different job family. */
export const stopJobOfKind = async (jobId: number, kinds: readonly JobKind[]): Promise<boolean> => {
  const snapshot = await readJobSnapshot(jobId);
  if (snapshot != null && kinds.includes(snapshot.kind)) {
    await markSnapshotCancelled(snapshot);
  }

  const job = await getQueueJob(jobId);
  let stopped = false;
  let modId = snapshot?.modId ?? null;

  if (!job) {
    if (snapshot == null || !kinds.includes(snapshot.kind)) return false;
    await publishJobControl(jobId, 'cancel');
    await markJobCancelled(jobId);
    stopped = true;
  } else {
    if (!kinds.includes(job.data.kind)) return false;
    modId = job.data.modId;
    const state = await job.getState();
    if (state === 'completed' || state === 'failed') return true;
    stopped = await requestJobStop(jobId);
  }

  if (stopped && modId != null) {
    await stopUnfinishedJobsForMod(kinds, modId, jobId);
  }
  return stopped;
};

/** Stop every unfinished job of these kinds for the mod (not just the first). */
export const stopJobForMod = async (kinds: readonly JobKind[], modId: number): Promise<boolean> =>
  stopUnfinishedJobsForMod(kinds, modId);

/** 409-guard: a truly running job of these kinds for this mod, if any. */
export const findActiveJobIdForMod = async (
  kinds: readonly JobKind[],
  modId: number,
): Promise<{ jobId: number; kind: JobKind } | null> => {
  const jobs = await listUnfinishedJobsForMod(kinds, modId);
  for (const job of jobs) {
    if (job.id == null) continue;
    const jobId = fromBullJobId(job.id);
    if (jobId == null) continue;
    const [snapshot, cancelledFlag, state] = await Promise.all([
      readJobSnapshot(jobId),
      isJobMarkedCancelled(jobId),
      job.getState(),
    ]);
    const disposition = classifyUnfinishedJob({
      snapshotStatus: snapshot?.status ?? null,
      cancelledFlag,
      queueState: state,
    });
    if (disposition === 'discard') {
      await removeIdleQueueJob(job);
      continue;
    }
    if (disposition === 'skip') continue;
    return { jobId, kind: job.data.kind };
  }
  return null;
};

/**
 * Status / stop helpers for the per-kind job routes
 * (`GET /api/llm-verify/:jobId`, `POST /api/tm-apply/:jobId/stop`, …).
 *
 * Routes stay thin: validate params, call one of these, return JSON.
 */
import { findUnfinishedJobForMod, fromBullJobId, getQueueJob, requestJobStop } from '../core/queue';
import { publishJobControl } from '../core/controlChannel';
import { readJobSnapshot, writeJobSnapshot } from '../core/snapshots';
import type { JobKind, JobSnapshot } from '../types';

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

/** Stop by job id; refuse ids that belong to a different job family. */
export const stopJobOfKind = async (jobId: number, kinds: readonly JobKind[]): Promise<boolean> => {
  const snapshot = await readJobSnapshot(jobId);
  if (snapshot != null && kinds.includes(snapshot.kind)) {
    await markSnapshotCancelled(snapshot);
  }

  const job = await getQueueJob(jobId);
  if (!job) {
    if (snapshot == null || !kinds.includes(snapshot.kind)) return false;
    await publishJobControl(jobId, 'cancel');
    return true;
  }
  if (!kinds.includes(job.data.kind)) return false;
  const state = await job.getState();
  if (state === 'completed' || state === 'failed') return true;
  return requestJobStop(jobId);
};

/** Stop by mod when the client does not know the job id yet (early Stop click). */
export const stopJobForMod = async (kinds: readonly JobKind[], modId: number): Promise<boolean> => {
  const job = await findUnfinishedJobForMod(kinds, modId);
  if (job?.id == null) {
    return false;
  }
  const id = fromBullJobId(job.id);
  if (id == null) return false;
  return stopJobOfKind(id, kinds);
};

/** 409-guard: an unfinished job of these kinds for this mod, if any. */
export const findActiveJobIdForMod = async (
  kinds: readonly JobKind[],
  modId: number,
): Promise<{ jobId: number; kind: JobKind } | null> => {
  const job = await findUnfinishedJobForMod(kinds, modId);
  if (job?.id == null) return null;
  const jobId = fromBullJobId(job.id);
  if (jobId == null) return null;
  const snapshot = await readJobSnapshot(jobId);
  if (snapshot && snapshot.status !== 'running') return null;
  return { jobId, kind: job.data.kind };
};

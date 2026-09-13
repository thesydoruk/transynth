/**
 * Resume LLM-queue jobs after a worker restart, and drop cancelled jobs that
 * still occupy the serial `transynth-llm` slot (Stop aborts in-flight HTTP
 * but BullMQ keeps the job `active` until the handler returns).
 *
 * Translate/verify/skip/gender pick up remaining work from the DB, so a new
 * job id is safe. A cancelled snapshot is never re-queued.
 */
import type { Job } from 'bullmq';
import { logJobs } from '../../../src/logging/loggers';
import type { JobData, JobSnapshot } from '../types';
import { allocateJobId, enqueueJob, findUnfinishedJobForMod, listActiveJobs } from './queue';
import { isLlmJobKind } from './queueNames';
import { fromBullJobId } from './jobId';
import { readJobSnapshot, writeJobSnapshot } from './snapshots';

const STALL_FAIL = /stalled more than allowable limit/i;

export type RecoverLlmJobsDeps = {
  getActiveJobs?: () => Promise<Array<Job<JobData> | undefined | null>>;
  findUnfinished?: typeof findUnfinishedJobForMod;
  allocateJobId?: typeof allocateJobId;
  enqueueJob?: typeof enqueueJob;
  readSnapshot?: typeof readJobSnapshot;
  writeSnapshot?: typeof writeJobSnapshot;
  log?: Pick<typeof logJobs, 'info' | 'warn'>;
};

export const isLlmStallFailure = (err: Error): boolean => STALL_FAIL.test(err.message);

const dropActiveJob = async (job: Job<JobData>): Promise<void> => {
  try {
    await job.moveToFailed(new Error('worker restarted'), '0');
    return;
  } catch {
    /* lock token is gone with the previous process */
  }
  try {
    await job.remove();
  } catch {
    /* already gone */
  }
};

const failOldSnapshot = async (
  oldId: number | null,
  deps: RecoverLlmJobsDeps,
  error: string,
): Promise<void> => {
  if (oldId == null) return;
  const readSnapshot = deps.readSnapshot ?? readJobSnapshot;
  const writeSnapshot = deps.writeSnapshot ?? writeJobSnapshot;
  const existing: JobSnapshot | null = await readSnapshot(oldId);
  if (!existing || existing.status !== 'running') return;
  await writeSnapshot({ ...existing, status: 'failed', error });
};

const requeue = async (data: JobData, deps: RecoverLlmJobsDeps): Promise<number> => {
  const allocate = deps.allocateJobId ?? allocateJobId;
  const enqueue = deps.enqueueJob ?? enqueueJob;
  const writeSnapshot = deps.writeSnapshot ?? writeJobSnapshot;
  const newId = await allocate();
  await writeSnapshot({
    jobId: newId,
    kind: data.kind,
    modId: data.modId,
    status: 'running',
    done: 0,
    total: 0,
    error: null,
    data: { jobId: newId },
  });
  await enqueue(data, newId);
  return newId;
};

/** Drop orphaned LLM jobs; re-enqueue only those still marked running. */
export const recoverOrphanedLlmJobs = async (deps: RecoverLlmJobsDeps = {}): Promise<number> => {
  const getActiveJobs = deps.getActiveJobs ?? listActiveJobs;
  const log = deps.log ?? logJobs;
  const readSnapshot = deps.readSnapshot ?? readJobSnapshot;
  const active = await getActiveJobs();
  let recovered = 0;
  for (const job of active) {
    if (!job || !isLlmJobKind(job.data.kind)) continue;
    const oldId = fromBullJobId(job.id);
    const snapshot = oldId != null ? await readSnapshot(oldId) : null;
    await dropActiveJob(job);
    if (snapshot?.status === 'cancelled') {
      log.info('dropped cancelled orphaned LLM job', {
        oldJobId: oldId,
        kind: job.data.kind,
        modId: job.data.modId,
      });
      continue;
    }
    await failOldSnapshot(oldId, deps, 'worker restarted');
    const newId = await requeue(job.data, deps);
    log.info('recovered orphaned LLM job', {
      oldJobId: oldId,
      newJobId: newId,
      kind: job.data.kind,
      modId: job.data.modId,
    });
    recovered += 1;
  }
  return recovered;
};

/** After BullMQ marks a stalled LLM job failed, start it again unless cancelled. */
export const requeueStalledLlmJob = async (
  job: Job<JobData>,
  err: Error,
  deps: RecoverLlmJobsDeps = {},
): Promise<number | null> => {
  if (!isLlmJobKind(job.data.kind) || !isLlmStallFailure(err)) return null;
  const findUnfinished = deps.findUnfinished ?? findUnfinishedJobForMod;
  const readSnapshot = deps.readSnapshot ?? readJobSnapshot;
  const log = deps.log ?? logJobs;
  const oldId = fromBullJobId(job.id);
  if (oldId != null) {
    const snapshot = await readSnapshot(oldId);
    if (snapshot?.status === 'cancelled') return null;
  }
  if (job.data.modId != null) {
    const existing = await findUnfinished([job.data.kind], job.data.modId);
    if (existing) return null;
  }
  const newId = await requeue(job.data, deps);
  log.info('requeued stalled LLM job', {
    oldJobId: oldId,
    newJobId: newId,
    kind: job.data.kind,
    modId: job.data.modId,
  });
  return newId;
};

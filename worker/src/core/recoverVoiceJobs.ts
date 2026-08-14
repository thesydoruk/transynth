/**
 * Resume voice-generate after a worker restart or BullMQ stall.
 *
 * Voice jobs are idempotent (`scope=missing` skips finished lines). Other
 * kinds stay failed on stall — re-running an LLM/import job from scratch
 * would do more harm than good.
 */
import type { Job } from 'bullmq';
import { logJobs } from '../../../src/logging/loggers';
import type { JobData, JobSnapshot } from '../types';
import { allocateJobId, enqueueJob, findUnfinishedJobForMod, getJobsQueue } from './queue';
import { fromBullJobId } from './jobId';
import { readJobSnapshot, writeJobSnapshot } from './snapshots';

const STALL_FAIL = /stalled more than allowable limit/i;

export type RecoverVoiceJobsDeps = {
  getActiveJobs?: () => Promise<Array<Job<JobData> | undefined | null>>;
  findUnfinished?: typeof findUnfinishedJobForMod;
  allocateJobId?: typeof allocateJobId;
  enqueueJob?: typeof enqueueJob;
  readSnapshot?: typeof readJobSnapshot;
  writeSnapshot?: typeof writeJobSnapshot;
  log?: Pick<typeof logJobs, 'info' | 'warn'>;
};

export const isVoiceStallFailure = (err: Error): boolean => STALL_FAIL.test(err.message);

const requeue = async (data: JobData, deps: RecoverVoiceJobsDeps): Promise<number> => {
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
    data: { jobId: newId, modId: data.modId, written: 0, skipped: 0, warningCount: 0 },
  });
  await enqueue(data, newId);
  return newId;
};

const failOldSnapshot = async (
  oldId: number | null,
  deps: RecoverVoiceJobsDeps,
  error: string,
): Promise<void> => {
  if (oldId == null) return;
  const readSnapshot = deps.readSnapshot ?? readJobSnapshot;
  const writeSnapshot = deps.writeSnapshot ?? writeJobSnapshot;
  const existing: JobSnapshot | null = await readSnapshot(oldId);
  if (!existing || existing.status !== 'running') return;
  await writeSnapshot({ ...existing, status: 'failed', error });
};

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

/** Re-enqueue active voice-generate jobs left behind by a previous worker process. */
export const recoverOrphanedVoiceGenerateJobs = async (
  deps: RecoverVoiceJobsDeps = {},
): Promise<number> => {
  const getActiveJobs = deps.getActiveJobs ?? (() => getJobsQueue().getJobs(['active']));
  const log = deps.log ?? logJobs;
  const active = await getActiveJobs();
  let recovered = 0;
  for (const job of active) {
    if (!job || job.data.kind !== 'voice-generate') continue;
    const oldId = fromBullJobId(job.id);
    await dropActiveJob(job);
    await failOldSnapshot(oldId, deps, 'worker restarted');
    const newId = await requeue(job.data, deps);
    log.info('recovered orphaned voice-generate', {
      oldJobId: oldId,
      newJobId: newId,
      modId: job.data.modId,
    });
    recovered += 1;
  }
  return recovered;
};

/** After BullMQ marks a stalled voice job failed, start it again unless one is already queued. */
export const requeueStalledVoiceGenerate = async (
  job: Job<JobData>,
  err: Error,
  deps: RecoverVoiceJobsDeps = {},
): Promise<number | null> => {
  if (job.data.kind !== 'voice-generate' || !isVoiceStallFailure(err)) return null;
  const findUnfinished = deps.findUnfinished ?? findUnfinishedJobForMod;
  const log = deps.log ?? logJobs;
  if (job.data.modId != null) {
    const existing = await findUnfinished(['voice-generate'], job.data.modId);
    if (existing) return null;
  }
  const newId = await requeue(job.data, deps);
  log.info('requeued stalled voice-generate', {
    oldJobId: fromBullJobId(job.id),
    newJobId: newId,
    modId: job.data.modId,
  });
  return newId;
};

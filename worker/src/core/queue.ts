/**
 * The BullMQ queue the API enqueues into and the worker drains.
 *
 * One queue carries every job kind. Per-kind fairness is unnecessary — the
 * real bottlenecks (LLM and TTS request pools) live inside the worker process.
 *
 * Job ids are allocated from our own Redis sequence *before* enqueue so the
 * API can subscribe to QueueEvents first and never miss a fast job's start.
 */
import { Queue, type Job, type JobType } from 'bullmq';
import { logJobs } from '../../../src/logging/loggers';
import type { JobData, JobKind } from '../types';
import { publishJobControl } from './controlChannel';
import { getSharedRedis } from './connection';
import { fromBullJobId, toBullJobId } from './jobId';
import { readJobSnapshot, writeJobSnapshot } from './snapshots';

export { fromBullJobId, toBullJobId } from './jobId';

export const JOBS_QUEUE_NAME = 'transynth-jobs';

/** States that still occupy the queue — used by duplicate-start (409) guards. */
const UNFINISHED_STATES: JobType[] = ['active', 'waiting', 'delayed', 'prioritized', 'paused'];

const JOB_ID_SEQ_KEY = 'transynth:jobs:id-seq';

/** Next numeric job id (API / snapshots / control channel). */
export const allocateJobId = async (): Promise<number> => getSharedRedis().incr(JOB_ID_SEQ_KEY);

let queue: Queue<JobData> | null = null;

export const getJobsQueue = (): Queue<JobData> => {
  if (!queue) {
    queue = new Queue<JobData>(JOBS_QUEUE_NAME, {
      connection: getSharedRedis(),
      defaultJobOptions: {
        // Domain code retries LLM/HTTP errors itself; re-running a multi-hour
        // job from scratch would do more harm than good.
        attempts: 1,
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 24 * 3600, count: 1000 },
      },
    });
  }
  return queue;
};

export const closeJobsQueue = async (): Promise<void> => {
  if (!queue) return;
  const q = queue;
  queue = null;
  await q.close();
};

export const getQueueJob = async (jobId: number): Promise<Job<JobData> | undefined> =>
  getJobsQueue().getJob(toBullJobId(jobId));

export const listUnfinishedJobs = async (kinds?: readonly JobKind[]): Promise<Job<JobData>[]> => {
  const jobs = await getJobsQueue().getJobs(UNFINISHED_STATES);
  return jobs.filter(
    (job): job is Job<JobData> => job != null && (!kinds || kinds.includes(job.data.kind)),
  );
};

export const findUnfinishedJobForMod = async (
  kinds: readonly JobKind[],
  modId: number,
): Promise<Job<JobData> | null> =>
  (await listUnfinishedJobs(kinds)).find((job) => job.data.modId === modId) ?? null;

/** Enqueue under a pre-allocated id (see `allocateJobId`). */
export const enqueueJob = async (data: JobData, jobId: number): Promise<void> => {
  await getJobsQueue().add(data.kind, data, { jobId: toBullJobId(jobId) });
  logJobs.info('enqueued', { jobId, kind: data.kind, modId: data.modId });
};

const writeCancelledSnapshot = async (job: Job<JobData>, jobId: number): Promise<void> => {
  const existing = await readJobSnapshot(jobId);
  await writeJobSnapshot({
    jobId,
    kind: job.data.kind,
    modId: job.data.modId,
    status: 'cancelled',
    done: existing?.done ?? 0,
    total: existing?.total ?? 0,
    error: null,
    data: existing?.data ?? {},
  });
};

const forceFailActiveJob = async (job: Job<JobData>, jobId: number): Promise<void> => {
  try {
    await job.moveToFailed(new Error('cancelled by user'), '0');
    return;
  } catch (err) {
    logJobs.warn('moveToFailed without worker lock failed', {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    await job.remove();
  } catch (err) {
    logJobs.warn('remove active job failed', {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

/**
 * Stop a job wherever it is:
 *   • still queued → remove from Redis + write a cancelled snapshot
 *   • already active → publish cancel, mark snapshot cancelled, force-fail if orphaned
 */
export const requestJobStop = async (jobId: number): Promise<boolean> => {
  const job = await getQueueJob(jobId);
  if (!job) return false;
  const state = await job.getState();
  if (state === 'completed' || state === 'failed' || state === 'unknown') return false;

  await writeCancelledSnapshot(job, jobId);

  if (state === 'active') {
    await publishJobControl(jobId, 'cancel');
    await forceFailActiveJob(job, jobId);
    return true;
  }

  try {
    await job.remove();
  } catch {
    await publishJobControl(jobId, 'cancel');
    await forceFailActiveJob(job, jobId);
  }
  return true;
};

/** Stop by mod when the client does not know the job id yet (e.g. early Stop). */
export const requestJobStopForMod = async (
  kinds: readonly JobKind[],
  modId: number,
): Promise<number | null> => {
  const job = await findUnfinishedJobForMod(kinds, modId);
  if (job?.id == null) return null;
  const id = fromBullJobId(job.id);
  return id != null && (await requestJobStop(id)) ? id : null;
};

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
import { writeJobSnapshot } from './snapshots';

export const JOBS_QUEUE_NAME = 'transynth-jobs';

/** States that still occupy the queue — used by duplicate-start (409) guards. */
const UNFINISHED_STATES: JobType[] = ['active', 'waiting', 'delayed', 'prioritized', 'paused'];

const JOB_ID_SEQ_KEY = 'transynth:jobs:id-seq';

/** Next numeric job id (also becomes the BullMQ job id string). */
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
  getJobsQueue().getJob(String(jobId));

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
  await getJobsQueue().add(data.kind, data, { jobId: String(jobId) });
  logJobs.info('enqueued', { jobId, kind: data.kind, modId: data.modId });
};

/**
 * Stop a job wherever it is:
 *   • still queued → remove from Redis + write a cancelled snapshot
 *   • already active → publish cancel on the control channel
 */
export const requestJobStop = async (jobId: number): Promise<boolean> => {
  const job = await getQueueJob(jobId);
  if (!job) return false;
  const state = await job.getState();
  if (state === 'completed' || state === 'failed' || state === 'unknown') return false;
  if (state === 'active') {
    await publishJobControl(jobId, 'cancel');
    return true;
  }
  try {
    await job.remove();
    await writeJobSnapshot({
      jobId,
      kind: job.data.kind,
      modId: job.data.modId,
      status: 'cancelled',
      done: 0,
      total: 0,
      error: null,
      data: {},
    });
  } catch {
    // Lost the race with the worker picking it up — cancel the running copy.
    await publishJobControl(jobId, 'cancel');
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
  return (await requestJobStop(Number(job.id))) ? Number(job.id) : null;
};

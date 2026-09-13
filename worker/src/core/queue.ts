/**
 * BullMQ queues the API enqueues into and the worker drains.
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
import { ALL_QUEUE_NAMES, JOBS_QUEUE_NAME, queueNameForKind } from './queueNames';
import { readJobSnapshot, writeJobSnapshot } from './snapshots';

export { fromBullJobId, toBullJobId } from './jobId';
export {
  ALL_QUEUE_NAMES,
  JOBS_QUEUE_NAME,
  LLM_QUEUE_NAME,
  VOICE_QUEUE_NAME,
  queueNameForKind,
} from './queueNames';

/** States that still occupy the queue — used by duplicate-start (409) guards. */
const UNFINISHED_STATES: JobType[] = [
  'active',
  'wait',
  'waiting',
  'delayed',
  'prioritized',
  'paused',
];

/** Queued but not executing — safe to `job.remove()` after Stop. */
const IDLE_QUEUE_STATES = new Set([
  'wait',
  'waiting',
  'delayed',
  'prioritized',
  'paused',
  'waiting-children',
]);

export const isIdleQueueState = (state: string): boolean => IDLE_QUEUE_STATES.has(state);

/** Drop a leftover waiting/delayed job; leave `active` alone (handler still holds the slot). */
export const removeIdleQueueJob = async (job: Job<JobData>): Promise<boolean> => {
  try {
    const state = await job.getState();
    if (!isIdleQueueState(state)) return false;
    await job.remove();
    return true;
  } catch {
    return false;
  }
};

const JOB_ID_SEQ_KEY = 'transynth:jobs:id-seq';

/** Next numeric job id (API / snapshots / control channel). */
export const allocateJobId = async (): Promise<number> => getSharedRedis().incr(JOB_ID_SEQ_KEY);

const DEFAULT_JOB_OPTIONS = {
  // Domain code retries LLM/HTTP errors itself; re-running a multi-hour
  // job from scratch would do more harm than good.
  attempts: 1,
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600, count: 1000 },
} as const;

const queues = new Map<string, Queue<JobData>>();

export const getQueueByName = (name: string): Queue<JobData> => {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue<JobData>(name, {
      connection: getSharedRedis(),
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    queues.set(name, queue);
  }
  return queue;
};

/** General queue (imports, TM apply, …). Prefer {@link getQueueByName} for new code. */
export const getJobsQueue = (): Queue<JobData> => getQueueByName(JOBS_QUEUE_NAME);

export const closeJobsQueue = async (): Promise<void> => {
  const open = [...queues.values()];
  queues.clear();
  await Promise.all(open.map((queue) => queue.close()));
};

export const getQueueJob = async (jobId: number): Promise<Job<JobData> | undefined> => {
  const id = toBullJobId(jobId);
  for (const name of ALL_QUEUE_NAMES) {
    const job = await getQueueByName(name).getJob(id);
    if (job) return job;
  }
  return undefined;
};

const isListedJob = (
  job: Job<JobData> | undefined,
  kinds?: readonly JobKind[],
): job is Job<JobData> => job != null && (!kinds || kinds.includes(job.data.kind));

export const listUnfinishedJobs = async (kinds?: readonly JobKind[]): Promise<Job<JobData>[]> => {
  const batches = await Promise.all(
    ALL_QUEUE_NAMES.map((name) => getQueueByName(name).getJobs(UNFINISHED_STATES)),
  );
  const seen = new Set<string>();
  const jobs: Job<JobData>[] = [];
  for (const job of batches.flat()) {
    if (!isListedJob(job, kinds) || job.id == null || seen.has(job.id)) continue;
    seen.add(job.id);
    jobs.push(job);
  }
  return jobs;
};

export const listActiveJobs = async (): Promise<Job<JobData>[]> => {
  const batches = await Promise.all(
    ALL_QUEUE_NAMES.map((name) => getQueueByName(name).getJobs(['active'])),
  );
  return batches.flat().filter((job): job is Job<JobData> => job != null);
};

export const findUnfinishedJobForMod = async (
  kinds: readonly JobKind[],
  modId: number,
): Promise<Job<JobData> | null> => (await listUnfinishedJobsForMod(kinds, modId))[0] ?? null;

export const listUnfinishedJobsForMod = async (
  kinds: readonly JobKind[],
  modId: number,
): Promise<Job<JobData>[]> =>
  (await listUnfinishedJobs(kinds)).filter((job) => job.data.modId === modId);

/** Enqueue under a pre-allocated id (see `allocateJobId`). */
export const enqueueJob = async (data: JobData, jobId: number): Promise<void> => {
  const queueName = queueNameForKind(data.kind);
  await getQueueByName(queueName).add(data.kind, data, { jobId: toBullJobId(jobId) });
  logJobs.info('enqueued', { jobId, kind: data.kind, modId: data.modId, queue: queueName });
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

/**
 * Stop a job wherever it is:
 *   • still queued → remove from Redis + write a cancelled snapshot
 *   • already active → publish cancel and let the worker abort (do not
 *     force-fail: that frees the serial slot while the handler is still in
 *     TTS / LLM, so the next queued job would start)
 */
export const requestJobStop = async (jobId: number): Promise<boolean> => {
  const job = await getQueueJob(jobId);
  if (!job) {
    await publishJobControl(jobId, 'cancel');
    return false;
  }
  const state = await job.getState();
  if (state === 'completed' || state === 'failed') return false;

  await writeCancelledSnapshot(job, jobId);
  await publishJobControl(jobId, 'cancel');

  if (state === 'active' || state === 'unknown') return true;

  try {
    await job.remove();
  } catch {
    /* waiting job may have become active between getState and remove */
  }
  return true;
};

/** Stop every unfinished job of these kinds for the mod (not just the first). */
export const requestJobStopForMod = async (
  kinds: readonly JobKind[],
  modId: number,
): Promise<number | null> => {
  const jobs = await listUnfinishedJobsForMod(kinds, modId);
  let firstStopped: number | null = null;
  for (const job of jobs) {
    if (job.id == null) continue;
    const id = fromBullJobId(job.id);
    if (id == null) continue;
    if (await requestJobStop(id)) firstStopped ??= id;
  }
  return firstStopped;
};

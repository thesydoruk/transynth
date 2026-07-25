import type { ActiveLlmSkipDetectJob, LlmSkipDetectJobSnapshot } from './types';

const activeJobs = new Map<number, ActiveLlmSkipDetectJob>();
let nextJobId = 1;

const toSnapshot = (job: ActiveLlmSkipDetectJob): LlmSkipDetectJobSnapshot => ({
  jobId: job.jobId,
  modId: job.modId,
  status: job.status,
  done: job.done,
  total: job.total,
  candidates: job.candidates,
  markedCount: job.markedCount,
  error: job.error,
});

export const allocateSkipDetectJobId = (): number => nextJobId++;

export const getLlmSkipDetectJob = (jobId: number): LlmSkipDetectJobSnapshot | null => {
  const job = activeJobs.get(jobId);
  return job ? toSnapshot(job) : null;
};

export const findRunningLlmSkipDetectJob = (modId: number): number | null => {
  for (const job of activeJobs.values()) {
    if (job.modId === modId && job.status === 'running') return job.jobId;
  }
  return null;
};

/** All in-flight skip-detect jobs (for status dashboards). */
export const listRunningLlmSkipDetectJobs = (): LlmSkipDetectJobSnapshot[] =>
  [...activeJobs.values()].filter((job) => job.status === 'running').map(toSnapshot);

export const requestLlmSkipDetectStop = (jobId: number): boolean => {
  const job = activeJobs.get(jobId);
  if (!job || job.status !== 'running') return false;
  job.cancel = true;
  job.status = 'cancelled';
  job.abort.abort();
  return true;
};

export const requestLlmSkipDetectStopByModId = (modId: number): boolean => {
  const jobId = findRunningLlmSkipDetectJob(modId);
  if (jobId == null) return false;
  return requestLlmSkipDetectStop(jobId);
};

export const registerSkipDetectJob = (job: ActiveLlmSkipDetectJob): void => {
  activeJobs.set(job.jobId, job);
};

export const deleteSkipDetectJob = (jobId: number): void => {
  activeJobs.delete(jobId);
};

export const scheduleLlmSkipDetectJobCleanup = (jobId: number, delayMs = 60_000): void => {
  setTimeout(() => {
    const job = activeJobs.get(jobId);
    if (job && job.status !== 'running') {
      activeJobs.delete(jobId);
    }
  }, delayMs);
};

export const toSkipDetectJobSnapshot = toSnapshot;

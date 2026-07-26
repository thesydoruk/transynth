import type { ActiveLlmGenderDetectJob, LlmGenderDetectJobSnapshot } from './types';

const activeJobs = new Map<number, ActiveLlmGenderDetectJob>();
let nextJobId = 1;

const toSnapshot = (job: ActiveLlmGenderDetectJob): LlmGenderDetectJobSnapshot => ({
  jobId: job.jobId,
  modId: job.modId,
  status: job.status,
  done: job.done,
  total: job.total,
  resolvedCount: job.resolvedCount,
  error: job.error,
});

export const allocateGenderDetectJobId = (): number => nextJobId++;

export const getLlmGenderDetectJob = (jobId: number): LlmGenderDetectJobSnapshot | null => {
  const job = activeJobs.get(jobId);
  return job ? toSnapshot(job) : null;
};

export const findRunningLlmGenderDetectJob = (modId: number): number | null => {
  for (const job of activeJobs.values()) {
    if (job.modId === modId && job.status === 'running') return job.jobId;
  }
  return null;
};

export const listRunningLlmGenderDetectJobs = (): LlmGenderDetectJobSnapshot[] =>
  [...activeJobs.values()].filter((job) => job.status === 'running').map(toSnapshot);

export const requestLlmGenderDetectStop = (jobId: number): boolean => {
  const job = activeJobs.get(jobId);
  if (!job || job.status !== 'running') return false;
  job.cancel = true;
  job.status = 'cancelled';
  job.abort.abort();
  return true;
};

export const requestLlmGenderDetectStopByModId = (modId: number): boolean => {
  const jobId = findRunningLlmGenderDetectJob(modId);
  if (jobId == null) return false;
  return requestLlmGenderDetectStop(jobId);
};

export const registerGenderDetectJob = (job: ActiveLlmGenderDetectJob): void => {
  activeJobs.set(job.jobId, job);
};

export const deleteGenderDetectJob = (jobId: number): void => {
  activeJobs.delete(jobId);
};

export const scheduleLlmGenderDetectJobCleanup = (jobId: number, delayMs = 60_000): void => {
  setTimeout(() => {
    const job = activeJobs.get(jobId);
    if (job && job.status !== 'running') activeJobs.delete(jobId);
  }, delayMs);
};

export const toGenderDetectJobSnapshot = toSnapshot;

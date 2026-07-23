import type { ActiveLlmVerifyJob, LlmVerifyJobSnapshot } from './types';

const activeJobs = new Map<number, ActiveLlmVerifyJob>();
let nextJobId = 1;

export const toVerifyJobSnapshot = (job: ActiveLlmVerifyJob): LlmVerifyJobSnapshot => ({
  jobId: job.jobId,
  modId: job.modId,
  status: job.status,
  done: job.done,
  total: job.total,
  approved: job.approved,
  fixed: job.fixed,
  issues: job.issues,
  actionLog: job.actionLog,
  error: job.error,
});

export const getActiveVerifyJobs = (): Map<number, ActiveLlmVerifyJob> => activeJobs;

export const allocateVerifyJobId = (): number => nextJobId++;

export const getLlmVerifyJob = (jobId: number): LlmVerifyJobSnapshot | null => {
  const job = activeJobs.get(jobId);
  return job ? toVerifyJobSnapshot(job) : null;
};

export const findRunningLlmVerifyJob = (modId: number): number | null => {
  for (const job of activeJobs.values()) {
    if (job.modId === modId && job.status === 'running') return job.jobId;
  }
  return null;
};

/** All in-flight verification jobs (for status dashboards). */
export const listRunningLlmVerifyJobs = (): LlmVerifyJobSnapshot[] =>
  [...activeJobs.values()].filter((job) => job.status === 'running').map(toVerifyJobSnapshot);

export const requestLlmVerifyStop = (jobId: number): boolean => {
  const job = activeJobs.get(jobId);
  if (!job || job.status !== 'running') return false;
  // Order matters: flag cancel before aborting so the abort error surfaces as a
  // cancellation (and isn't recorded as a job failure).
  job.cancel = true;
  job.abort.abort();
  return true;
};

/** Idempotent stop — returns false only when no running job exists for this mod. */
export const requestLlmVerifyStopByModId = (modId: number): boolean => {
  const jobId = findRunningLlmVerifyJob(modId);
  if (jobId == null) return false;
  return requestLlmVerifyStop(jobId);
};

/**
 * Mark a stuck running job as failed (route-level safety net).
 * Returns the jobId when a running job was found, else null.
 */
export const failRunningLlmVerifyJob = (modId: number, error: string): number | null => {
  const jobId = findRunningLlmVerifyJob(modId);
  if (jobId == null) return null;
  const job = activeJobs.get(jobId);
  if (!job) return null;
  job.status = 'failed';
  job.error = error;
  return jobId;
};

/** Remove finished jobs from memory after a delay to allow status polling. */
export const scheduleLlmVerifyJobCleanup = (jobId: number, delayMs = 60_000): void => {
  setTimeout(() => {
    const job = activeJobs.get(jobId);
    if (job && job.status !== 'running') {
      activeJobs.delete(jobId);
    }
  }, delayMs);
};

export const registerVerifyJob = (job: ActiveLlmVerifyJob): void => {
  activeJobs.set(job.jobId, job);
};

export const deleteVerifyJob = (jobId: number): void => {
  activeJobs.delete(jobId);
};

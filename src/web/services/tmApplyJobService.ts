/**
 * In-memory mod-wide TM apply jobs with SSE progress.
 */
import type { Tx } from '../../db';
import { log } from '../../logger';
import { applyTMToMod, countUntranslatedStrings } from './tm';

export type TmApplyJobStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export type TmApplyJobSnapshot = {
  jobId: number;
  modId: number;
  status: TmApplyJobStatus;
  done: number;
  total: number;
  applied: number;
  skipped: number;
  error: string | null;
};

type ActiveTmApplyJob = TmApplyJobSnapshot & {
  cancel: boolean;
  srcLang: string;
  targetLang: string;
};

const activeJobs = new Map<number, ActiveTmApplyJob>();
let nextJobId = 1;

const toSnapshot = (job: ActiveTmApplyJob): TmApplyJobSnapshot => ({
  jobId: job.jobId,
  modId: job.modId,
  status: job.status,
  done: job.done,
  total: job.total,
  applied: job.applied,
  skipped: job.skipped,
  error: job.error,
});

export const getTmApplyJob = (jobId: number): TmApplyJobSnapshot | null => {
  const job = activeJobs.get(jobId);
  return job ? toSnapshot(job) : null;
};

export const findRunningTmApplyJob = (modId: number): number | null => {
  for (const job of activeJobs.values()) {
    if (job.modId === modId && job.status === 'running') return job.jobId;
  }
  return null;
};

export const listRunningTmApplyJobs = (): TmApplyJobSnapshot[] =>
  [...activeJobs.values()].filter((job) => job.status === 'running').map(toSnapshot);

export const requestTmApplyStop = (jobId: number): boolean => {
  const job = activeJobs.get(jobId);
  if (!job || job.status !== 'running') return false;
  job.cancel = true;
  job.status = 'cancelled';
  return true;
};

export const requestTmApplyStopByModId = (modId: number): boolean => {
  const jobId = findRunningTmApplyJob(modId);
  if (jobId == null) return false;
  return requestTmApplyStop(jobId);
};

export type TmApplyProgressEvent =
  | { type: 'started'; jobId: number; total: number }
  | { type: 'progress'; done: number; total: number; applied: number }
  | {
      type: 'done';
      done: number;
      total: number;
      applied: number;
      skipped: number;
    }
  | { type: 'cancelled'; done: number; total: number; applied: number; skipped: number }
  | { type: 'error'; error: string };

const cleanupTimers = new Map<number, ReturnType<typeof setTimeout>>();

export const scheduleTmApplyJobCleanup = (jobId: number): void => {
  const prev = cleanupTimers.get(jobId);
  if (prev) clearTimeout(prev);
  cleanupTimers.set(
    jobId,
    setTimeout(() => {
      activeJobs.delete(jobId);
      cleanupTimers.delete(jobId);
    }, 60_000),
  );
};

export const runTmApplyJob = async (
  db: Tx,
  opts: { modId: number; srcLang: string; targetLang: string },
  onEvent: (event: TmApplyProgressEvent) => void,
): Promise<TmApplyJobSnapshot> => {
  const runningJobId = findRunningTmApplyJob(opts.modId);
  if (runningJobId != null) {
    throw new Error(`TM apply already running for mod ${opts.modId} (job #${runningJobId})`);
  }

  const jobId = nextJobId++;
  const job: ActiveTmApplyJob = {
    jobId,
    modId: opts.modId,
    status: 'running',
    done: 0,
    total: 0,
    applied: 0,
    skipped: 0,
    error: null,
    cancel: false,
    srcLang: opts.srcLang,
    targetLang: opts.targetLang,
  };
  activeJobs.set(jobId, job);

  try {
    let result = { applied: 0, skipped: 0, byMethod: {} as Record<string, number> };

    const wrappedApply = async () => {
      result = await applyTMToMod(db, opts.modId, opts.targetLang, opts.srcLang, {
        shouldCancel: () => job.cancel,
        onProgress: ({ done, total, applied }) => {
          job.done = done;
          job.total = total;
          job.applied = applied;
          job.skipped = done - applied;
          onEvent({ type: 'progress', done, total, applied });
        },
      });
    };

    // Pre-count untranslated strings for progress total
    job.total = await countUntranslatedStrings(db, opts.modId, opts.targetLang, opts.srcLang);

    log.info('TM apply job started', {
      jobId,
      modId: opts.modId,
      total: job.total,
      srcLang: opts.srcLang,
      targetLang: opts.targetLang,
    });

    onEvent({ type: 'started', jobId, total: job.total });

    if (job.total === 0) {
      job.status = 'completed';
      onEvent({
        type: 'done',
        done: 0,
        total: 0,
        applied: 0,
        skipped: 0,
      });
      return toSnapshot(job);
    }

    await wrappedApply();

    job.applied = result.applied;
    job.skipped = result.skipped;

    if (job.cancel || job.status === 'cancelled') {
      if (job.status === 'running') job.status = 'cancelled';
      onEvent({
        type: 'cancelled',
        done: job.done,
        total: job.total,
        applied: job.applied,
        skipped: job.skipped,
      });
    } else {
      job.status = 'completed';
      onEvent({
        type: 'done',
        done: job.done,
        total: job.total,
        applied: job.applied,
        skipped: job.skipped,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.error = message;
    log.error('TM apply job failed', { jobId, error: message });
    onEvent({ type: 'error', error: message });
  }

  return toSnapshot(job);
};

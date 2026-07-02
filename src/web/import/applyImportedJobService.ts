/**
 * In-memory apply-imported translation jobs.
 *
 * Jobs are not persisted — they are lost on worker restart by design.
 */
import type { Tx } from '../../db';
import {
  applyImportedModStringsAsTranslations,
  countApplyImportedTargetStrings,
} from '../data/queries';
import { log } from '../../logger';

export type ApplyImportedStats = {
  applied: number;
  skipped: number;
  unmatched: number;
  empty: number;
};

export type ApplyImportedJobStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export type ApplyImportedJobSnapshot = {
  jobId: number;
  targetModId: number;
  fromModId: number;
  importedLang: string;
  status: ApplyImportedJobStatus;
  done: number;
  total: number;
  stats: ApplyImportedStats;
  error: string | null;
};

type ActiveApplyImportedJob = ApplyImportedJobSnapshot & {
  cancel: boolean;
  srcLang: string;
  targetLang: string;
};

const activeJobs = new Map<number, ActiveApplyImportedJob>();
let nextJobId = 1;

const emptyStats = (): ApplyImportedStats => ({
  applied: 0,
  skipped: 0,
  unmatched: 0,
  empty: 0,
});

const toSnapshot = (job: ActiveApplyImportedJob): ApplyImportedJobSnapshot => ({
  jobId: job.jobId,
  targetModId: job.targetModId,
  fromModId: job.fromModId,
  importedLang: job.importedLang,
  status: job.status,
  done: job.done,
  total: job.total,
  stats: job.stats,
  error: job.error,
});

export const getApplyImportedJob = (jobId: number): ApplyImportedJobSnapshot | null => {
  const job = activeJobs.get(jobId);
  return job ? toSnapshot(job) : null;
};

export const findRunningApplyImportedJob = (targetModId: number): number | null => {
  for (const job of activeJobs.values()) {
    if (job.targetModId === targetModId && job.status === 'running') return job.jobId;
  }
  return null;
};

export const requestApplyImportedStop = (jobId: number): boolean => {
  const job = activeJobs.get(jobId);
  if (!job || job.status !== 'running') return false;
  job.cancel = true;
  return true;
};

export type ApplyImportedProgressEvent =
  | { type: 'started'; jobId: number; total: number }
  | { type: 'progress'; done: number; total: number; stats: ApplyImportedStats }
  | { type: 'done'; done: number; total: number; stats: ApplyImportedStats }
  | { type: 'cancelled'; done: number; total: number; stats: ApplyImportedStats }
  | { type: 'error'; error: string };

export const runApplyImportedJob = async (
  db: Tx,
  opts: {
    targetModId: number;
    fromModId: number;
    importedLang: string;
    srcLang: string;
    targetLang: string;
  },
  onEvent: (event: ApplyImportedProgressEvent) => void,
): Promise<ApplyImportedJobSnapshot> => {
  const runningJobId = findRunningApplyImportedJob(opts.targetModId);
  if (runningJobId != null) {
    throw new Error(
      `Apply-imported already running for mod ${opts.targetModId} (job #${runningJobId})`,
    );
  }

  const total = await countApplyImportedTargetStrings(db, opts.targetModId, opts.srcLang);
  if (total === 0) {
    throw new Error(`Target mod has no source strings for lang "${opts.srcLang}"`);
  }

  const jobId = nextJobId++;
  const job: ActiveApplyImportedJob = {
    jobId,
    targetModId: opts.targetModId,
    fromModId: opts.fromModId,
    importedLang: opts.importedLang,
    status: 'running',
    done: 0,
    total,
    stats: emptyStats(),
    error: null,
    cancel: false,
    srcLang: opts.srcLang,
    targetLang: opts.targetLang,
  };
  activeJobs.set(jobId, job);

  onEvent({ type: 'started', jobId, total });

  try {
    const result = await applyImportedModStringsAsTranslations(
      db,
      opts.targetModId,
      opts.fromModId,
      opts.importedLang,
      opts.targetLang,
      opts.srcLang,
      {
        shouldCancel: () => job.cancel,
        onProgress: (done, progressTotal, stats) => {
          job.done = done;
          job.total = progressTotal;
          job.stats = stats;
          onEvent({ type: 'progress', done, total: progressTotal, stats });
        },
      },
    );

    job.stats = {
      applied: result.applied,
      skipped: result.skipped,
      unmatched: result.unmatched,
      empty: result.empty,
    };
    job.done = job.total;

    if (result.cancelled || job.cancel) {
      job.status = 'cancelled';
      onEvent({
        type: 'cancelled',
        done: job.done,
        total: job.total,
        stats: job.stats,
      });
    } else {
      job.status = 'completed';
      onEvent({
        type: 'done',
        done: job.done,
        total: job.total,
        stats: job.stats,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, jobId, targetModId: opts.targetModId }, 'Apply-imported job failed');
    job.status = 'failed';
    job.error = message;
    onEvent({ type: 'error', error: message });
  }

  return toSnapshot(job);
};

export const scheduleApplyImportedJobCleanup = (jobId: number, delayMs = 60_000): void => {
  setTimeout(() => {
    const job = activeJobs.get(jobId);
    if (job && job.status !== 'running') {
      activeJobs.delete(jobId);
    }
  }, delayMs);
};

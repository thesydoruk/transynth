/**
 * In-memory mod-wide voice synthesis jobs (XTTS WAV → import localize/).
 */
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import { log } from '../../logger';
import { countVoiceLocalizeWork, localizeModImportVoice } from '../../voice';
import { resolveImportPackages } from '../../modImport';
import { loadModImportPaths } from '../import/resolveModImportPaths';

export type ModVoiceGenerateJobStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export type ModVoiceGenerateJobSnapshot = {
  jobId: number;
  modId: number;
  status: ModVoiceGenerateJobStatus;
  done: number;
  total: number;
  written: number;
  skipped: number;
  warningCount: number;
  error: string | null;
};

type ActiveModVoiceGenerateJob = ModVoiceGenerateJobSnapshot & {
  cancel: boolean;
};

const activeJobs = new Map<number, ActiveModVoiceGenerateJob>();
let nextJobId = 1;

const toSnapshot = (job: ActiveModVoiceGenerateJob): ModVoiceGenerateJobSnapshot => ({
  jobId: job.jobId,
  modId: job.modId,
  status: job.status,
  done: job.done,
  total: job.total,
  written: job.written,
  skipped: job.skipped,
  warningCount: job.warningCount,
  error: job.error,
});

export const getModVoiceGenerateJob = (jobId: number): ModVoiceGenerateJobSnapshot | null => {
  const job = activeJobs.get(jobId);
  return job ? toSnapshot(job) : null;
};

export const findRunningModVoiceGenerateJob = (modId: number): number | null => {
  for (const job of activeJobs.values()) {
    if (job.modId === modId && job.status === 'running') return job.jobId;
  }
  return null;
};

/** All in-flight voice generation jobs (for status dashboards). */
export const listRunningModVoiceGenerateJobs = (): ModVoiceGenerateJobSnapshot[] =>
  [...activeJobs.values()].filter((job) => job.status === 'running').map(toSnapshot);

export const requestModVoiceGenerateStop = (jobId: number): boolean => {
  const job = activeJobs.get(jobId);
  if (!job || job.status !== 'running') return false;
  job.cancel = true;
  return true;
};

export const requestModVoiceGenerateStopByModId = (modId: number): boolean => {
  const jobId = findRunningModVoiceGenerateJob(modId);
  if (jobId == null) return false;
  return requestModVoiceGenerateStop(jobId);
};

export type ModVoiceGenerateProgressEvent =
  | { type: 'started'; jobId: number; total: number }
  | { type: 'progress'; done: number; total: number }
  | {
      type: 'done';
      done: number;
      total: number;
      written: number;
      skipped: number;
      warningCount: number;
    }
  | { type: 'cancelled'; done: number; total: number }
  | { type: 'error'; error: string };

export const runModVoiceGenerateJob = async (
  db: Tx,
  opts: {
    modId: number;
    srcLang: string;
    targetLang: string;
    game: string;
    modName?: string | null;
  },
  onEvent: (event: ModVoiceGenerateProgressEvent) => void,
): Promise<ModVoiceGenerateJobSnapshot> => {
  const runningJobId = findRunningModVoiceGenerateJob(opts.modId);
  if (runningJobId != null) {
    throw new Error(
      `Voice generation already running for mod ${opts.modId} (job #${runningJobId})`,
    );
  }

  const paths = await loadModImportPaths(db, { modId: opts.modId });
  const packages = resolveImportPackages(paths.extractDir, paths.pluginPath);
  const total = await countVoiceLocalizeWork(
    db,
    opts.modId,
    packages,
    opts.srcLang,
    opts.targetLang,
  );
  if (total === 0) {
    throw new Error('No voiced lines with translations to synthesize');
  }

  const jobId = nextJobId++;
  const job: ActiveModVoiceGenerateJob = {
    jobId,
    modId: opts.modId,
    status: 'running',
    done: 0,
    total,
    written: 0,
    skipped: 0,
    warningCount: 0,
    error: null,
    cancel: false,
  };
  activeJobs.set(jobId, job);

  log.info(
    `[Voice generate mod #${opts.modId}] job #${jobId} started (${total} lines, ${opts.srcLang}→${opts.targetLang})`,
  );
  onEvent({ type: 'started', jobId, total });

  try {
    const result = await localizeModImportVoice(db, {
      extractDir: paths.extractDir,
      pluginPath: paths.pluginPath,
      modId: opts.modId,
      srcLang: opts.srcLang,
      tgtLang: opts.targetLang,
      shouldCancel: () => job.cancel,
      onProgress: (done, progressTotal) => {
        job.done = done;
        job.total = progressTotal;
        onEvent({ type: 'progress', done, total: progressTotal });
      },
    });

    job.written = result.written.length;
    job.skipped = result.skipped.length;
    job.warningCount = result.warnings.length;

    if (job.cancel) {
      job.status = 'cancelled';
      log.info(`[Voice generate mod #${opts.modId}] job #${jobId} cancelled`, {
        done: job.done,
        total: job.total,
      });
      onEvent({ type: 'cancelled', done: job.done, total: job.total });
    } else {
      job.status = 'completed';
      log.info(`[Voice generate mod #${opts.modId}] job #${jobId} completed`, {
        done: job.done,
        total: job.total,
        written: job.written,
        skipped: job.skipped,
        warnings: job.warningCount,
      });
      onEvent({
        type: 'done',
        done: job.done,
        total: job.total,
        written: job.written,
        skipped: job.skipped,
        warningCount: job.warningCount,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.error = message;
    log.error(`[Voice generate mod #${opts.modId}] job #${jobId} failed: ${message}`);
    onEvent({ type: 'error', error: message });
  }

  return toSnapshot(job);
};

export const scheduleModVoiceGenerateJobCleanup = (jobId: number, delayMs = 60_000): void => {
  setTimeout(() => {
    const job = activeJobs.get(jobId);
    if (job && job.status !== 'running') {
      activeJobs.delete(jobId);
    }
  }, delayMs);
};

/**
 * Apply-imported translation job body (runs inside the worker).
 */
import type { Tx } from '../../../../src/db';
import {
  applyImportedModStringsAsTranslations,
  countApplyImportedTargetStrings,
} from '../../../../src/web/data/queries';
import { log } from '../../../../src/logger';

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

export type ApplyImportedProgressEvent =
  | { type: 'started'; jobId: number; total: number }
  | { type: 'progress'; done: number; total: number; stats: ApplyImportedStats }
  | { type: 'done'; done: number; total: number; stats: ApplyImportedStats }
  | { type: 'cancelled'; done: number; total: number; stats: ApplyImportedStats }
  | { type: 'error'; error: string };

const emptyStats = (): ApplyImportedStats => ({
  applied: 0,
  skipped: 0,
  unmatched: 0,
  empty: 0,
});

export const runApplyImportedJob = async (
  db: Tx,
  opts: {
    jobId: number;
    targetModId: number;
    fromModId: number;
    importedLang: string;
    srcLang: string;
    targetLang: string;
    isCancelled: () => boolean;
  },
  onEvent: (event: ApplyImportedProgressEvent) => void,
): Promise<ApplyImportedJobSnapshot> => {
  const { jobId, targetModId } = opts;
  const total = await countApplyImportedTargetStrings(db, targetModId, opts.srcLang);
  if (total === 0) {
    throw new Error(`Target mod has no source strings for lang "${opts.srcLang}"`);
  }

  let done = 0;
  let progressTotal = total;
  let stats = emptyStats();
  let status: ApplyImportedJobStatus = 'running';
  let error: string | null = null;

  const snapshot = (): ApplyImportedJobSnapshot => ({
    jobId,
    targetModId,
    fromModId: opts.fromModId,
    importedLang: opts.importedLang,
    status,
    done,
    total: progressTotal,
    stats,
    error,
  });

  onEvent({ type: 'started', jobId, total });

  try {
    const result = await applyImportedModStringsAsTranslations(
      db,
      targetModId,
      opts.fromModId,
      opts.importedLang,
      opts.targetLang,
      opts.srcLang,
      {
        shouldCancel: opts.isCancelled,
        onProgress: (d, t, s) => {
          done = d;
          progressTotal = t;
          stats = s;
          onEvent({ type: 'progress', done, total: t, stats });
        },
      },
    );

    stats = {
      applied: result.applied,
      skipped: result.skipped,
      unmatched: result.unmatched,
      empty: result.empty,
    };
    done = progressTotal;

    if (result.cancelled || opts.isCancelled()) {
      status = 'cancelled';
      onEvent({ type: 'cancelled', done, total: progressTotal, stats });
    } else {
      status = 'completed';
      onEvent({ type: 'done', done, total: progressTotal, stats });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, jobId, targetModId }, 'Apply-imported job failed');
    status = 'failed';
    error = message;
    onEvent({ type: 'error', error: message });
  }

  return snapshot();
};

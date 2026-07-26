/**
 * Mod-wide TM apply job body (runs inside the worker).
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

export const runTmApplyJob = async (
  db: Tx,
  opts: {
    jobId: number;
    modId: number;
    srcLang: string;
    targetLang: string;
    isCancelled: () => boolean;
  },
  onEvent: (event: TmApplyProgressEvent) => void,
): Promise<TmApplyJobSnapshot> => {
  const { jobId, modId } = opts;
  let done = 0;
  let total = 0;
  let applied = 0;
  let skipped = 0;
  let status: TmApplyJobStatus = 'running';
  let error: string | null = null;

  const snapshot = (): TmApplyJobSnapshot => ({
    jobId,
    modId,
    status,
    done,
    total,
    applied,
    skipped,
    error,
  });

  try {
    total = await countUntranslatedStrings(db, modId, opts.targetLang, opts.srcLang);

    log.info('TM apply job started', {
      jobId,
      modId,
      total,
      srcLang: opts.srcLang,
      targetLang: opts.targetLang,
    });

    onEvent({ type: 'started', jobId, total });

    if (total === 0) {
      status = 'completed';
      onEvent({ type: 'done', done: 0, total: 0, applied: 0, skipped: 0 });
      return snapshot();
    }

    const result = await applyTMToMod(db, modId, opts.targetLang, opts.srcLang, {
      shouldCancel: opts.isCancelled,
      onProgress: ({ done: d, total: t, applied: a }) => {
        done = d;
        total = t;
        applied = a;
        skipped = d - a;
        onEvent({ type: 'progress', done, total, applied });
      },
    });

    applied = result.applied;
    skipped = result.skipped;

    if (opts.isCancelled()) {
      status = 'cancelled';
      onEvent({ type: 'cancelled', done, total, applied, skipped });
    } else {
      status = 'completed';
      onEvent({ type: 'done', done, total, applied, skipped });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status = 'failed';
    error = message;
    log.error('TM apply job failed', { jobId, error: message });
    onEvent({ type: 'error', error: message });
  }

  return snapshot();
};

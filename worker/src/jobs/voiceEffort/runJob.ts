/**
 * Mod-wide vocal effort analysis job body (`voice-effort`).
 *
 * Decodes and measures the mod's original takes and stores which lines get an
 * effort tag. It saves as it goes, so a stopped job, or one a deploy killed,
 * carries on from where it was when it runs again (see `recoverVoiceJobs`).
 */
import type { Tx } from '../../../../src/db';
import { log } from '../../../../src/logger';
import {
  analyzeModVocalEffort,
  type AnalyzeVocalEffortOptions,
  type AnalyzeVocalEffortResult,
} from '../../../../src/voice/analyzeVocalEffort';

export type VoiceEffortJobStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export type VoiceEffortJobSnapshot = {
  jobId: number;
  modId: number;
  status: VoiceEffortJobStatus;
  /** Takes with a measurement, of all the mod's takes. */
  done: number;
  total: number;
  error: string | null;
  /** What the run found; also set for a stopped run (measured so far, nothing planned). */
  result: AnalyzeVocalEffortResult | null;
};

export type VoiceEffortProgressEvent =
  | { type: 'started'; jobId: number; total: number }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; done: number; total: number; result: AnalyzeVocalEffortResult }
  | { type: 'cancelled'; done: number; total: number }
  | { type: 'error'; error: string };

/** A take is measured in a few milliseconds; the browser needs a step a second at most. */
const PROGRESS_EVERY_MS = 1000;

type Analyze = (
  db: Tx,
  modId: number,
  options: AnalyzeVocalEffortOptions,
) => Promise<AnalyzeVocalEffortResult>;

export const runVoiceEffortJob = async (
  db: Tx,
  opts: { jobId: number; modId: number; workers?: number; isCancelled: () => boolean },
  onEvent: (event: VoiceEffortProgressEvent) => void,
  analyze: Analyze = analyzeModVocalEffort,
  now: () => number = Date.now,
): Promise<VoiceEffortJobSnapshot> => {
  const { jobId, modId } = opts;
  const snapshot: VoiceEffortJobSnapshot = {
    jobId,
    modId,
    status: 'running',
    done: 0,
    total: 0,
    error: null,
    result: null,
  };
  let started = false;
  let lastSent = 0;

  const fail = (message: string): VoiceEffortJobSnapshot => {
    log.error(`[Vocal effort mod #${modId}] job #${jobId} failed: ${message}`);
    onEvent({ type: 'error', error: message });
    return { ...snapshot, status: 'failed', error: message };
  };

  try {
    const result = await analyze(db, modId, {
      workers: opts.workers,
      shouldCancel: opts.isCancelled,
      log: (message) => log.info(`[Vocal effort mod #${modId}] job #${jobId} ${message}`),
      onProgress: (done, total) => {
        snapshot.done = done;
        snapshot.total = total;
        if (!started) {
          started = true;
          lastSent = now();
          onEvent({ type: 'started', jobId, total });
          onEvent({ type: 'progress', done, total });
          return;
        }
        if (now() - lastSent < PROGRESS_EVERY_MS && done < total) return;
        lastSent = now();
        onEvent({ type: 'progress', done, total });
      },
    });
    snapshot.result = result;
    if (result.skipped) return fail(result.reason ?? 'nothing to analyze');
    if (result.cancelled || opts.isCancelled()) {
      log.info(`[Vocal effort mod #${modId}] job #${jobId} cancelled`, {
        done: snapshot.done,
        total: snapshot.total,
      });
      onEvent({ type: 'cancelled', done: snapshot.done, total: snapshot.total });
      return { ...snapshot, status: 'cancelled' };
    }
    snapshot.done = result.takes;
    snapshot.total = result.takes;
    log.info(`[Vocal effort mod #${modId}] job #${jobId} completed`, result);
    onEvent({ type: 'done', done: snapshot.done, total: snapshot.total, result });
    return { ...snapshot, status: 'completed' };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
};

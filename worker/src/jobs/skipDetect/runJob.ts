/**
 * Non-translatable string detection job body (heuristics + optional LLM audit).
 */
import type { Tx } from '../../../../src/db';
import { CONFIG } from '../../../../src/config';
import { logVerify } from '../../../../src/logging/loggers';
import { pushCapped, trimCappedArray } from '../../core/cappedArray';
import { resetModSkipDetectState } from '../../../../src/web/data/queries';
import { runModSkipDetectPipeline } from './pipeline/runPipeline';
import type { LlmSkipDetectCandidate } from './queries';
import type { SkipDetectPipelineProgress } from './pipeline/types';
import { countScannableStrings } from './queries';
import type {
  LlmSkipDetectJobSnapshot,
  LlmSkipDetectJobStatus,
  LlmSkipDetectProgressEvent,
} from './types';

export const runLlmSkipDetectJob = async (
  db: Tx,
  opts: {
    jobId: number;
    modId: number;
    srcLang: string;
    modName?: string | null;
    game?: string | null;
    useLlm?: boolean;
    persist?: boolean;
    force?: boolean;
    dbChunkSize?: number;
    signal: AbortSignal;
    isCancelled: () => boolean;
  },
  onEvent: (event: LlmSkipDetectProgressEvent) => void,
): Promise<LlmSkipDetectJobSnapshot> => {
  const { jobId, modId } = opts;
  const useLlm = opts.useLlm === true;
  const persist = opts.persist === true;
  const force = opts.force === true;

  let done = 0;
  let total = 0;
  let markedCount = 0;
  const candidates: LlmSkipDetectCandidate[] = [];
  let status: LlmSkipDetectJobStatus = 'running';
  let error: string | null = null;

  const snapshot = (): LlmSkipDetectJobSnapshot => ({
    jobId,
    modId,
    status,
    done,
    total,
    candidates,
    markedCount,
    error,
  });

  try {
    if (force) {
      const forceReset = await resetModSkipDetectState(db, modId, opts.srcLang);
      logVerify.info('skip-detect force reset', { modId, ...forceReset });
    }

    total = await countScannableStrings(db, modId, opts.srcLang, force);
    if (total === 0) {
      throw new Error(
        force
          ? 'No strings to scan'
          : 'No unscanned strings — use force to reset skip flags and re-scan all strings',
      );
    }

    logVerify.info('skip-detect job started', {
      jobId,
      modId,
      total,
      useLlm,
      persist,
      force,
      srcLang: opts.srcLang,
      dbChunkSize: opts.dbChunkSize ?? CONFIG.dbChunkSize,
      workers: useLlm ? undefined : CONFIG.skipDetectWorkers,
    });

    onEvent({ type: 'started', jobId, total, useLlm, persist });

    const summary = await runModSkipDetectPipeline(
      db,
      {
        modId,
        srcLang: opts.srcLang,
        modName: opts.modName,
        game: opts.game,
        useLlm,
        persist,
        force,
        dbChunkSize: opts.dbChunkSize,
        knownTotal: total,
        shouldCancel: opts.isCancelled,
        signal: opts.signal,
      },
      {
        collectCandidate: (candidate: LlmSkipDetectCandidate) => {
          pushCapped(candidates, candidate, CONFIG.jobSnapshotMaxRows);
        },
        onProgress: (progress: SkipDetectPipelineProgress) => {
          done = progress.done;
          markedCount = progress.markedCount;
          onEvent({
            type: 'progress',
            done: progress.done,
            total,
            ...(progress.candidatesBatch?.length
              ? { candidatesBatch: progress.candidatesBatch }
              : {}),
          });
        },
      },
    );

    done = summary.done;
    markedCount = summary.markedCount;

    trimCappedArray(candidates, CONFIG.jobSnapshotMaxRows);

    if (opts.isCancelled()) {
      status = 'cancelled';
      onEvent({ type: 'cancelled', done, total, markedCount });
    } else {
      status = 'completed';
      onEvent({ type: 'done', done, total, markedCount });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status = 'failed';
    error = message;
    logVerify.error('skip-detect job failed', { jobId, error: message });
    onEvent({ type: 'error', error: message });
  }

  return snapshot();
};

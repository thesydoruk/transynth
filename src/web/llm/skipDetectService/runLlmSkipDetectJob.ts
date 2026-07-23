/**
 * Non-translatable string detection jobs (heuristics + optional LLM audit).
 */
import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { logVerify } from '../../../logging/loggers';
import { resetModSkipDetectState } from '../../data/queries';
import { runModSkipDetectPipeline } from '../skipDetectPipeline/runModSkipDetectPipeline';
import type { LlmSkipDetectCandidate } from './queries';
import type { SkipDetectPipelineProgress } from '../skipDetectPipeline/types';
import { countScannableStrings } from './queries';
import {
  allocateSkipDetectJobId,
  deleteSkipDetectJob,
  findRunningLlmSkipDetectJob,
  registerSkipDetectJob,
  toSkipDetectJobSnapshot,
} from './jobRegistry';
import type {
  ActiveLlmSkipDetectJob,
  LlmSkipDetectJobSnapshot,
  LlmSkipDetectProgressEvent,
} from './types';

export const runLlmSkipDetectJob = async (
  db: Tx,
  opts: {
    modId: number;
    srcLang: string;
    modName?: string | null;
    game?: string | null;
    useLlm?: boolean;
    persist?: boolean;
    force?: boolean;
    dbChunkSize?: number;
  },
  onEvent: (event: LlmSkipDetectProgressEvent) => void,
): Promise<LlmSkipDetectJobSnapshot> => {
  const runningJobId = findRunningLlmSkipDetectJob(opts.modId);
  if (runningJobId != null) {
    throw new Error(`Skip-detect already running for mod ${opts.modId} (job #${runningJobId})`);
  }

  const useLlm = opts.useLlm === true;
  const persist = opts.persist === true;
  const force = opts.force === true;

  const jobId = allocateSkipDetectJobId();
  const job: ActiveLlmSkipDetectJob = {
    jobId,
    modId: opts.modId,
    status: 'running',
    done: 0,
    total: 0,
    candidates: [],
    markedCount: 0,
    error: null,
    cancel: false,
    srcLang: opts.srcLang,
    useLlm,
    persist,
    force,
    abort: new AbortController(),
  };
  registerSkipDetectJob(job);

  let total = 0;
  try {
    if (force) {
      const forceReset = await resetModSkipDetectState(db, opts.modId, opts.srcLang);
      logVerify.info('skip-detect force reset', {
        modId: opts.modId,
        ...forceReset,
      });
    }

    total = await countScannableStrings(db, opts.modId, opts.srcLang, force);
    if (total === 0) {
      deleteSkipDetectJob(jobId);
      throw new Error(
        force
          ? 'No strings to scan'
          : 'No unscanned strings — use force to reset skip flags and re-scan all strings',
      );
    }
    job.total = total;

    logVerify.info('skip-detect job started', {
      jobId,
      modId: opts.modId,
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
        modId: opts.modId,
        srcLang: opts.srcLang,
        modName: opts.modName,
        game: opts.game,
        useLlm,
        persist,
        force,
        dbChunkSize: opts.dbChunkSize,
        knownTotal: total,
        shouldCancel: () => job.cancel,
        signal: job.abort.signal,
      },
      {
        collectCandidate: (candidate: LlmSkipDetectCandidate) => {
          job.candidates.push(candidate);
        },
        onProgress: (progress: SkipDetectPipelineProgress) => {
          job.done = progress.done;
          job.markedCount = progress.markedCount;
          onEvent({
            type: 'progress',
            done: progress.done,
            total: job.total,
            ...(progress.candidatesBatch?.length
              ? { candidatesBatch: progress.candidatesBatch }
              : {}),
          });
        },
      },
    );

    job.done = summary.done;
    job.markedCount = summary.markedCount;

    if (job.cancel) {
      job.status = 'cancelled';
      onEvent({
        type: 'cancelled',
        done: job.done,
        total: job.total,
        candidates: job.candidates,
        markedCount: job.markedCount,
      });
    } else {
      job.status = 'completed';
      onEvent({
        type: 'done',
        done: job.done,
        total: job.total,
        candidates: job.candidates,
        markedCount: job.markedCount,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.error = message;
    logVerify.error('skip-detect job failed', { jobId, error: message });
    onEvent({ type: 'error', error: message });
  }

  return toSkipDetectJobSnapshot(job);
};

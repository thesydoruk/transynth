import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { logTranslate } from '../../../logging/loggers';
import { resetModGenderDetectState } from '../../data/queries/narratorGender';
import { runModGenderDetectPipeline } from '../genderDetectPipeline/runModGenderDetectPipeline';
import { countGenderDetectRecords } from '../../data/queries/narratorGender';
import type {
  LlmGenderDetectJobSnapshot,
  LlmGenderDetectJobStatus,
  LlmGenderDetectProgressEvent,
} from './types';

export const runLlmGenderDetectJob = async (
  db: Tx,
  opts: {
    jobId: number;
    modId: number;
    srcLang: string;
    modName?: string | null;
    game?: string | null;
    useLlm?: boolean;
    force?: boolean;
    dbChunkSize?: number;
    signal: AbortSignal;
    isCancelled: () => boolean;
  },
  onEvent: (event: LlmGenderDetectProgressEvent) => void,
): Promise<LlmGenderDetectJobSnapshot> => {
  const { jobId, modId } = opts;
  const useLlm = opts.useLlm !== false;
  let force = opts.force === true;

  let done = 0;
  let total = 0;
  let resolvedCount = 0;
  let status: LlmGenderDetectJobStatus = 'running';
  let error: string | null = null;

  const snapshot = (): LlmGenderDetectJobSnapshot => ({
    jobId,
    modId,
    status,
    done,
    total,
    resolvedCount,
    error,
  });

  try {
    if (force) {
      const reset = await resetModGenderDetectState(db, modId);
      logTranslate.info('gender-detect force reset', { modId, reset });
    }

    total = await countGenderDetectRecords(db, modId, opts.srcLang, force);
    if (total === 0 && !force) {
      force = true;
      total = await countGenderDetectRecords(db, modId, opts.srcLang, true);
      if (total > 0) {
        const reset = await resetModGenderDetectState(db, modId);
        logTranslate.info('gender-detect auto force reset (no pending records)', {
          modId,
          reset,
        });
      }
    }

    if (total === 0) {
      throw new Error(
        force
          ? 'No narrative records to scan'
          : 'No unscanned narrative records — use force to re-scan',
      );
    }

    onEvent({ type: 'started', jobId, total });

    const summary = await runModGenderDetectPipeline(
      db,
      {
        modId,
        srcLang: opts.srcLang,
        modName: opts.modName,
        game: opts.game,
        useLlm,
        force,
        dbChunkSize: opts.dbChunkSize ?? CONFIG.dbChunkSize,
        knownTotal: total,
        shouldCancel: opts.isCancelled,
        signal: opts.signal,
      },
      {
        onProgress: (progress) => {
          done = progress.done;
          resolvedCount = progress.resolvedCount;
          onEvent({
            type: 'progress',
            done: progress.done,
            total,
            ...(progress.resolvedBatch?.length ? { resolvedBatch: progress.resolvedBatch } : {}),
          });
        },
      },
    );

    done = summary.done;
    resolvedCount = summary.resolvedCount;

    if (opts.isCancelled()) {
      status = 'cancelled';
      onEvent({ type: 'cancelled', done, total, resolvedCount });
    } else {
      status = 'completed';
      onEvent({ type: 'done', done, total, resolvedCount });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status = 'failed';
    error = message;
    logTranslate.error('gender-detect job failed', { jobId, error: message });
    onEvent({ type: 'error', error: message });
  }

  return snapshot();
};

export type { LlmGenderDetectJobSnapshot, LlmGenderDetectProgressEvent } from './types';

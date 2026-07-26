import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { logTranslate } from '../../../logging/loggers';
import { resetModGenderDetectState } from '../../data/queries/narratorGender';
import { runModGenderDetectPipeline } from '../genderDetectPipeline/runModGenderDetectPipeline';
import { countGenderDetectRecords } from '../../data/queries/narratorGender';
import {
  allocateGenderDetectJobId,
  deleteGenderDetectJob,
  findRunningLlmGenderDetectJob,
  registerGenderDetectJob,
  toGenderDetectJobSnapshot,
} from './jobRegistry';
import type {
  ActiveLlmGenderDetectJob,
  LlmGenderDetectJobSnapshot,
  LlmGenderDetectProgressEvent,
} from './types';

export const runLlmGenderDetectJob = async (
  db: Tx,
  opts: {
    modId: number;
    srcLang: string;
    modName?: string | null;
    game?: string | null;
    useLlm?: boolean;
    force?: boolean;
    dbChunkSize?: number;
  },
  onEvent: (event: LlmGenderDetectProgressEvent) => void,
): Promise<LlmGenderDetectJobSnapshot> => {
  const runningJobId = findRunningLlmGenderDetectJob(opts.modId);
  if (runningJobId != null) {
    throw new Error(`Gender-detect already running for mod ${opts.modId} (job #${runningJobId})`);
  }

  const useLlm = opts.useLlm !== false;
  let force = opts.force === true;

  const jobId = allocateGenderDetectJobId();
  const job: ActiveLlmGenderDetectJob = {
    jobId,
    modId: opts.modId,
    status: 'running',
    done: 0,
    total: 0,
    resolvedCount: 0,
    error: null,
    cancel: false,
    srcLang: opts.srcLang,
    useLlm,
    force,
    abort: new AbortController(),
  };
  registerGenderDetectJob(job);

  try {
    if (force) {
      const reset = await resetModGenderDetectState(db, opts.modId);
      logTranslate.info('gender-detect force reset', { modId: opts.modId, reset });
    }

    let total = await countGenderDetectRecords(db, opts.modId, opts.srcLang, force);
    if (total === 0 && !force) {
      force = true;
      total = await countGenderDetectRecords(db, opts.modId, opts.srcLang, true);
      if (total > 0) {
        const reset = await resetModGenderDetectState(db, opts.modId);
        logTranslate.info('gender-detect auto force reset (no pending records)', {
          modId: opts.modId,
          reset,
        });
      }
    }
    job.force = force;

    if (total === 0) {
      deleteGenderDetectJob(jobId);
      throw new Error(
        force
          ? 'No narrative records to scan'
          : 'No unscanned narrative records — use force to re-scan',
      );
    }
    job.total = total;

    onEvent({ type: 'started', jobId, total });

    const summary = await runModGenderDetectPipeline(
      db,
      {
        modId: opts.modId,
        srcLang: opts.srcLang,
        modName: opts.modName,
        game: opts.game,
        useLlm,
        force,
        dbChunkSize: opts.dbChunkSize ?? CONFIG.dbChunkSize,
        knownTotal: total,
        shouldCancel: () => job.cancel,
        signal: job.abort.signal,
      },
      {
        onProgress: (progress) => {
          job.done = progress.done;
          job.resolvedCount = progress.resolvedCount;
          onEvent({
            type: 'progress',
            done: progress.done,
            total: job.total,
            ...(progress.resolvedBatch?.length ? { resolvedBatch: progress.resolvedBatch } : {}),
          });
        },
      },
    );

    job.done = summary.done;
    job.resolvedCount = summary.resolvedCount;

    if (job.cancel) {
      job.status = 'cancelled';
      onEvent({
        type: 'cancelled',
        done: job.done,
        total: job.total,
        resolvedCount: job.resolvedCount,
      });
    } else {
      job.status = 'completed';
      onEvent({
        type: 'done',
        done: job.done,
        total: job.total,
        resolvedCount: job.resolvedCount,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.error = message;
    logTranslate.error('gender-detect job failed', { jobId, error: message });
    onEvent({ type: 'error', error: message });
  }

  return toGenderDetectJobSnapshot(job);
};

export {
  findRunningLlmGenderDetectJob,
  getLlmGenderDetectJob,
  listRunningLlmGenderDetectJobs,
  requestLlmGenderDetectStop,
  requestLlmGenderDetectStopByModId,
  scheduleLlmGenderDetectJobCleanup,
} from './jobRegistry';

export type { LlmGenderDetectJobSnapshot, LlmGenderDetectProgressEvent } from './types';

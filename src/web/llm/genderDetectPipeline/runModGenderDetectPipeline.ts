import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import {
  countGenderDetectRecords,
  iterateGenderDetectWorkUnits,
  markGenderDetectScanned,
  persistNarratorGenderResults,
} from '../../data/queries/narratorGender';
import { runLlmChunkWorkPoolFromFeed } from '../../../llm/chunkRecovery';
import { llmChatPipelineConcurrency } from '../../../llm/requestPool';
import { logTranslate } from '../../../logging/loggers';
import { Semaphore } from '../../../utils/concurrency';
import { GENDER_DETECT_LLM_BATCH_SIZE } from './constants';
import { processGenderDetectChunk } from './processChunk';
import type {
  ChunkPersistJob,
  RunModGenderDetectPipelineHandlers,
  RunModGenderDetectPipelineOpts,
  GenderDetectPipelineSummary,
} from './types';

export type {
  RunModGenderDetectPipelineHandlers,
  RunModGenderDetectPipelineOpts,
  GenderDetectPipelineProgress,
  GenderDetectPipelineSummary,
} from './types';

export const runModGenderDetectPipeline = async (
  db: Tx,
  opts: RunModGenderDetectPipelineOpts,
  handlers: RunModGenderDetectPipelineHandlers = {},
): Promise<GenderDetectPipelineSummary> => {
  const useLlm = opts.useLlm === true;
  const force = opts.force === true;
  const dbChunkSize = Math.max(20, opts.dbChunkSize ?? 200);
  const workers = Math.max(1, opts.workers ?? llmChatPipelineConcurrency());
  const shouldCancel = opts.shouldCancel;
  const processBatchSize = GENDER_DETECT_LLM_BATCH_SIZE;

  const total =
    opts.knownTotal ?? (await countGenderDetectRecords(db, opts.modId, opts.srcLang, force));
  if (total === 0) {
    throw new Error(
      force
        ? 'No narrative records to scan'
        : 'No unscanned narrative records — use force to re-scan',
    );
  }

  const persistPool = new Semaphore(Math.max(2, Math.min(8, CONFIG.dbPoolMax)));
  const persistJobs: Promise<void>[] = [];

  let done = 0;
  let resolvedCount = 0;

  const emitProgress = (extra?: Partial<import('./types').GenderDetectPipelineProgress>): void => {
    handlers.onProgress?.({ done, total, resolvedCount, ...extra });
  };

  const scheduleChunkPersist = (job: ChunkPersistJob): void => {
    if (shouldCancel?.()) return;

    persistJobs.push(
      persistPool.run(async () => {
        if (shouldCancel?.()) return;

        const definite = job.results.filter((r) => r.gender !== 'unknown');
        if (definite.length > 0) {
          await persistNarratorGenderResults(
            db,
            definite.map((r) => ({
              recordId: r.recordId,
              gender: r.gender,
              source: r.source,
            })),
          );
          resolvedCount += definite.length;
        }

        await markGenderDetectScanned(db, job.scannedIds);
        done += job.scannedIds.length;

        emitProgress({
          resolvedBatch: job.results.filter((r) => r.llmResult).map((r) => r.llmResult!),
        });
      }),
    );
  };

  logTranslate.info('gender-detect pipeline started', {
    modId: opts.modId,
    total,
    useLlm,
    force,
    dbChunkSize,
    workers,
  });

  async function* chunkFeed() {
    for await (const unit of iterateGenderDetectWorkUnits(db, {
      modId: opts.modId,
      srcLang: opts.srcLang,
      force,
      dbChunkSize,
      processBatchSize,
    })) {
      yield unit.chunk;
    }
  }

  await runLlmChunkWorkPoolFromFeed(chunkFeed(), {
    concurrency: workers,
    maxBufferedChunks: workers * 2,
    shouldAbort: shouldCancel,
    runOnce: async (chunk, { enqueueSplit }) => {
      if (shouldCancel?.()) return;
      const results = await processGenderDetectChunk(chunk, opts, enqueueSplit);
      scheduleChunkPersist({ scannedIds: chunk.map((r) => r.record_id), results });
    },
    onFailure: (failed, message) => {
      logTranslate.error('gender-detect chunk failed; continuing', {
        modId: opts.modId,
        error: message,
        recordIds: failed.map((r) => r.record_id),
      });
      scheduleChunkPersist({
        scannedIds: failed.map((r) => r.record_id),
        results: [],
      });
    },
    log: logTranslate,
    operation: 'gender-detect',
    itemIds: (chunk) => chunk.map((r) => r.record_id),
  });

  if (persistJobs.length > 0) await Promise.all(persistJobs);

  const summary = { done, resolvedCount };
  logTranslate.info('gender-detect pipeline completed', { modId: opts.modId, total, ...summary });
  return summary;
};

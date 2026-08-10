import type { Tx } from '../../../../../src/db';
import { CONFIG } from '../../../../../src/config';
import type { ImportPackageContext } from '../../../../../src/modImport';
import {
  countStressPlaceWork,
  iterateStressPlaceWorkUnits,
  persistStressPlacementResults,
} from '../../../../../src/web/data/queries/stressPlacement';
import type { ModStressPlaceScope } from '../../../../../src/web/data/queries/stressPlacement';
import { runLlmChunkWorkPoolFromFeed } from '../../../../../src/llm/chunkRecovery';
import { llmChatPipelineConcurrency } from '../../../../../src/llm/requestPool';
import { logTranslate } from '../../../../../src/logging/loggers';
import { Semaphore } from '../../../../../src/utils/concurrency';
import { getProjectSetting } from '../../../../../src/web/services/projectSettings';
import { STRESS_PLACE_LLM_BATCH_SIZE } from './constants';
import { processStressPlaceChunk } from './processChunk';

export type RunModStressPlacePipelineOpts = {
  modId: number;
  packages: readonly ImportPackageContext[];
  srcLang: string;
  targetLang: string;
  scope: ModStressPlaceScope;
  speakerKey?: string;
  knownTotal?: number;
  shouldCancel?: () => boolean;
  signal?: AbortSignal;
  workers?: number;
  /** Override project setting `llm.stress_place_thinking` for this run. */
  enableThinking?: boolean;
};

export type StressPlacePipelineSummary = {
  done: number;
  total: number;
  placedCount: number;
};

export const runModStressPlacePipeline = async (
  db: Tx,
  opts: RunModStressPlacePipelineOpts,
  handlers: { onProgress?: (done: number, placedCount: number) => void } = {},
): Promise<StressPlacePipelineSummary> => {
  const workers = Math.max(1, opts.workers ?? llmChatPipelineConcurrency());
  const shouldCancel = opts.shouldCancel;
  const total =
    opts.knownTotal ??
    (await countStressPlaceWork(
      db,
      opts.modId,
      opts.packages,
      opts.srcLang,
      opts.targetLang,
      opts.scope,
      opts.speakerKey,
    ));
  if (total === 0) {
    throw new Error('No voice lines need stress placement');
  }

  const persistPool = new Semaphore(Math.max(2, Math.min(8, CONFIG.dbPoolMax)));
  const persistJobs: Promise<void>[] = [];
  let done = 0;
  let placedCount = 0;
  const enableThinking =
    opts.enableThinking ?? (await getProjectSetting(db, 'llm.stress_place_thinking'));
  const pipelineOpts: RunModStressPlacePipelineOpts = { ...opts, enableThinking };

  async function* chunkFeed() {
    for await (const chunk of iterateStressPlaceWorkUnits(db, {
      modId: opts.modId,
      packages: opts.packages,
      srcLang: opts.srcLang,
      tgtLang: opts.targetLang,
      scope: opts.scope,
      speakerKey: opts.speakerKey,
      batchSize: STRESS_PLACE_LLM_BATCH_SIZE,
    })) {
      yield chunk;
    }
  }

  logTranslate.info('stress-place pipeline started', {
    modId: opts.modId,
    total,
    scope: opts.scope,
    workers,
    enableThinking,
  });

  await runLlmChunkWorkPoolFromFeed(chunkFeed(), {
    concurrency: workers,
    maxBufferedChunks: workers * 2,
    shouldAbort: shouldCancel,
    runOnce: async (chunk, { enqueueSplit }) => {
      if (shouldCancel?.()) return;
      const results = await processStressPlaceChunk(chunk, pipelineOpts, enqueueSplit);
      persistJobs.push(
        persistPool.run(async () => {
          if (results.length > 0) {
            placedCount += await persistStressPlacementResults(db, results);
          }
          done += chunk.length;
          handlers.onProgress?.(done, placedCount);
        }),
      );
    },
    onFailure: (failed, message) => {
      logTranslate.error('stress-place chunk failed; continuing', {
        modId: opts.modId,
        error: message,
        translationIds: failed.map((row) => row.translation_id),
      });
      done += failed.length;
      handlers.onProgress?.(done, placedCount);
    },
    log: logTranslate,
    operation: 'stress-place',
    itemIds: (chunk) => chunk.map((row) => row.translation_id),
  });

  await Promise.all(persistJobs);
  return { done, total, placedCount };
};

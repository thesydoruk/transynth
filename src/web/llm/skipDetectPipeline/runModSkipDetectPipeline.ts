/**
 * High-throughput skip-detect pipeline — DB prefetch, parallel heuristics + LLM audit,
 * and async persist so workers stay busy on large mods.
 */
import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { markStringsAsSkip, markStringsSkipDetectScanned } from '../../data/queries';
import { runLlmChunkWorkPoolFromFeed } from '../../../llm/chunkRecovery';
import { llmChatPipelineConcurrency } from '../../../llm/requestPool';
import { logVerify } from '../../../logging/loggers';
import { Semaphore } from '../../../utils/concurrency';
import { countScannableStrings, iterateSkipDetectWorkUnits } from '../skipDetectService/queries';
import { SKIP_DETECT_LLM_BATCH_SIZE } from './constants';
import { processSkipDetectChunk } from './processChunk';
import type {
  ChunkPersistJob,
  RunModSkipDetectPipelineHandlers,
  RunModSkipDetectPipelineOpts,
  SkipDetectPipelineSummary,
} from './types';

export type {
  RunModSkipDetectPipelineHandlers,
  RunModSkipDetectPipelineOpts,
  SkipDetectPipelineProgress,
  SkipDetectPipelineSummary,
} from './types';

export { SKIP_DETECT_LLM_BATCH_SIZE } from './constants';

export const runModSkipDetectPipeline = async (
  db: Tx,
  opts: RunModSkipDetectPipelineOpts,
  handlers: RunModSkipDetectPipelineHandlers = {},
): Promise<SkipDetectPipelineSummary> => {
  const useLlm = opts.useLlm === true;
  const persist = opts.persist === true;
  const force = opts.force === true;
  const dbChunkSize = Math.max(50, opts.dbChunkSize ?? CONFIG.dbChunkSize);
  const workers = Math.max(
    1,
    opts.workers ?? (useLlm ? llmChatPipelineConcurrency() : CONFIG.skipDetectWorkers),
  );
  const shouldCancel = opts.shouldCancel;
  const processBatchSize = useLlm ? SKIP_DETECT_LLM_BATCH_SIZE : undefined;

  const total =
    opts.knownTotal ?? (await countScannableStrings(db, opts.modId, opts.srcLang, force));
  if (total === 0) {
    throw new Error(
      force
        ? 'No strings to scan'
        : 'No unscanned strings — use force to reset skip flags and re-scan all strings',
    );
  }

  const persistConcurrency = Math.max(2, Math.min(8, CONFIG.dbPoolMax));
  const persistPool = new Semaphore(persistConcurrency);
  const persistJobs: Promise<void>[] = [];

  let done = 0;
  let candidateCount = 0;
  let markedCount = 0;

  const emitProgress = (extra?: Partial<import('./types').SkipDetectPipelineProgress>): void => {
    handlers.onProgress?.({
      done,
      total,
      candidateCount,
      markedCount,
      ...extra,
    });
  };

  const scheduleChunkPersist = (job: ChunkPersistJob): void => {
    if (shouldCancel?.()) return;

    persistJobs.push(
      persistPool.run(async () => {
        try {
          if (shouldCancel?.()) return;

          let marked = 0;
          if (persist && job.candidates.length > 0) {
            marked = await markStringsAsSkip(
              db,
              job.candidates.map((c) => c.stringId),
            );
            markedCount += marked;
          }

          await markStringsSkipDetectScanned(db, job.scannedIds);
          done += job.scannedIds.length;
          candidateCount += job.candidates.length;

          for (const candidate of job.candidates) {
            handlers.collectCandidate?.(candidate);
          }

          emitProgress({
            candidatesBatch: job.candidates.length > 0 ? job.candidates : undefined,
            markedCount,
          });
        } catch (err) {
          logVerify.error('skip-detect persist chunk failed', {
            err: err instanceof Error ? err.message : String(err),
            scannedIds: job.scannedIds.length,
          });
        }
      }),
    );
  };

  logVerify.info('skip-detect pipeline started', {
    modId: opts.modId,
    total,
    useLlm,
    persist,
    force,
    dbChunkSize,
    workers,
    llmBatchSize: useLlm ? SKIP_DETECT_LLM_BATCH_SIZE : null,
    srcLang: opts.srcLang,
  });

  async function* chunkFeed(): AsyncGenerator<
    readonly import('../skipDetectService/queries').ScanStringRow[]
  > {
    for await (const unit of iterateSkipDetectWorkUnits(db, {
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
      if (useLlm && chunk.length === 1) {
        logVerify.debug('solo LLM skip-detect request', { stringId: chunk[0]!.string_id });
      }
      const candidates = await processSkipDetectChunk(chunk, opts, enqueueSplit);
      scheduleChunkPersist({
        scannedIds: chunk.map((row) => row.string_id),
        candidates,
      });
    },
    onFailure: (failed, message) => {
      logVerify.error('skip-detect chunk failed; continuing', {
        modId: opts.modId,
        error: message,
        stringIds: failed.map((row) => row.string_id),
      });
      scheduleChunkPersist({
        scannedIds: failed.map((row) => row.string_id),
        candidates: [],
      });
    },
    log: logVerify,
    operation: 'skip-detect',
    itemIds: (chunk) => chunk.map((row) => row.string_id),
  });

  if (persistJobs.length > 0) {
    logVerify.debug('draining skip-detect persist queue', { jobs: persistJobs.length });
    await Promise.all(persistJobs);
  }

  const summary: SkipDetectPipelineSummary = {
    done,
    candidateCount,
    markedCount,
  };

  logVerify.info('skip-detect pipeline completed', {
    modId: opts.modId,
    total,
    ...summary,
  });

  return summary;
};

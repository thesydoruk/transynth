/**
 * High-throughput skip-detect pipeline — DB prefetch, parallel heuristics,
 * and async persist so workers stay busy on large mods.
 */
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import { partitionSkipAuditRows } from '../../llm/skipTranslateHeuristics';
import { markStringsAsSkip, markStringsSkipDetectScanned } from '../data/queries';
import { parseRecordLocation } from '../../utils/recordLocation';
import { runLlmChunkWorkPoolFromFeed } from '../../llm/chunkRecovery';
import { logVerify } from '../../logging/loggers';
import { Semaphore } from '../../utils/concurrency';
import {
  countScannableStrings,
  iterateSkipDetectWorkUnits,
  type LlmSkipDetectCandidate,
  type ScanStringRow,
} from './llmSkipDetectService';

export type SkipDetectPipelineProgress = {
  done: number;
  total: number;
  candidateCount: number;
  markedCount: number;
  /** New hits from the latest persisted chunk (for streaming UIs). */
  candidatesBatch?: LlmSkipDetectCandidate[];
};

export type RunModSkipDetectPipelineOpts = {
  modId: number;
  srcLang: string;
  persist?: boolean;
  force?: boolean;
  dbChunkSize?: number;
  workers?: number;
  shouldCancel?: () => boolean;
  knownTotal?: number;
};

export type RunModSkipDetectPipelineHandlers = {
  onProgress?: (progress: SkipDetectPipelineProgress) => void;
  collectCandidate?: (candidate: LlmSkipDetectCandidate) => void;
};

export type SkipDetectPipelineSummary = {
  done: number;
  candidateCount: number;
  markedCount: number;
};

type ChunkPersistJob = {
  scannedIds: number[];
  candidates: LlmSkipDetectCandidate[];
};

const analyzeChunk = (chunk: ScanStringRow[]): LlmSkipDetectCandidate[] => {
  const auditRows = chunk.map((row) => {
    const { grup } = parseRecordLocation(row.signature, row.path);
    return {
      id: row.string_id,
      source: row.source,
      edid: row.edid,
      path: row.path,
      signature: grup,
      context: row.context,
    };
  });

  const { heuristicHits } = partitionSkipAuditRows(auditRows);
  const candidates: LlmSkipDetectCandidate[] = [];

  for (const row of chunk) {
    const heuristic = heuristicHits.get(row.string_id);
    if (!heuristic) continue;
    candidates.push({
      stringId: row.string_id,
      source: row.source,
      signature: row.signature,
      path: row.path,
      edid: row.edid,
      reason: heuristic.reason,
      confidence: 0.85,
      method: 'heuristic',
    });
  }

  return candidates;
};

export const runModSkipDetectPipeline = async (
  db: Tx,
  opts: RunModSkipDetectPipelineOpts,
  handlers: RunModSkipDetectPipelineHandlers = {},
): Promise<SkipDetectPipelineSummary> => {
  const persist = opts.persist === true;
  const force = opts.force === true;
  const dbChunkSize = Math.max(50, opts.dbChunkSize ?? CONFIG.dbChunkSize);
  const workers = Math.max(1, opts.workers ?? CONFIG.skipDetectWorkers);
  const shouldCancel = opts.shouldCancel;

  const total =
    opts.knownTotal ?? (await countScannableStrings(db, opts.modId, opts.srcLang, force));
  if (total === 0) {
    throw new Error(
      force
        ? 'No strings to scan'
        : 'No unscanned strings — use force to re-scan already audited rows',
    );
  }

  const persistConcurrency = Math.max(2, Math.min(8, CONFIG.dbPoolMax));
  const persistPool = new Semaphore(persistConcurrency);
  const persistJobs: Promise<void>[] = [];

  let done = 0;
  let candidateCount = 0;
  let markedCount = 0;

  const emitProgress = (extra?: Partial<SkipDetectPipelineProgress>): void => {
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
      }),
    );
  };

  logVerify.info('skip-detect pipeline started', {
    modId: opts.modId,
    total,
    persist,
    force,
    dbChunkSize,
    workers,
    srcLang: opts.srcLang,
  });

  async function* chunkFeed(): AsyncGenerator<readonly ScanStringRow[]> {
    for await (const unit of iterateSkipDetectWorkUnits(db, {
      modId: opts.modId,
      srcLang: opts.srcLang,
      force,
      dbChunkSize,
    })) {
      yield unit.chunk;
    }
  }

  await runLlmChunkWorkPoolFromFeed(chunkFeed(), {
    concurrency: workers,
    maxBufferedChunks: workers * 2,
    shouldAbort: shouldCancel,
    runOnce: async (chunk, _helpers) => {
      if (shouldCancel?.()) return;
      const candidates = analyzeChunk([...chunk]);
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

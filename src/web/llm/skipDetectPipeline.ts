/**
 * High-throughput skip-detect pipeline — DB prefetch, parallel heuristics + LLM audit,
 * and async persist so workers stay busy on large mods.
 */
import type { Tx } from '../../db';
import { CONFIG, getTranslateModel } from '../../config';
import { partitionSkipAuditRows } from '../../llm/skipTranslateHeuristics';
import {
  detectSkipCandidatesWithLlm,
  isLlmSkipDetectMissingIdsError,
  type LlmSkipDetectItem,
  type LlmSkipDetectItemResult,
} from '../../llm/skipTranslateDetect';
import { markStringsAsSkip, markStringsSkipDetectScanned } from '../data/queries';
import { parseRecordLocation } from '../../utils/recordLocation';
import {
  enqueueSoloChunks,
  runLlmChunkWithRecovery,
  runLlmChunkWorkPoolFromFeed,
} from '../../llm/chunkRecovery';
import { withRequestDeadline } from '../../llm/requestDeadline';
import { isLlmTimeoutError } from '../../llm/retry';
import { llmChatPipelineConcurrency } from '../../llm/requestPool';
import { logVerify } from '../../logging/loggers';
import { Semaphore } from '../../utils/concurrency';
import {
  countScannableStrings,
  iterateSkipDetectWorkUnits,
  type LlmSkipDetectCandidate,
  type ScanStringRow,
} from './llmSkipDetectService';

/** Rows per LLM HTTP request — defaults to BATCH_SIZE (skip-detect has no RAG). */
export const SKIP_DETECT_LLM_BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.LLM_SKIP_DETECT_BATCH_SIZE || String(CONFIG.batchSize), 10),
);

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
  modName?: string | null;
  game?: string | null;
  useLlm?: boolean;
  persist?: boolean;
  force?: boolean;
  dbChunkSize?: number;
  workers?: number;
  shouldCancel?: () => boolean;
  signal?: AbortSignal;
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

const rowById = (chunk: readonly ScanStringRow[]): Map<number, ScanStringRow> => {
  const map = new Map<number, ScanStringRow>();
  for (const row of chunk) map.set(row.string_id, row);
  return map;
};

const toLlmItems = (rows: readonly ScanStringRow[]): LlmSkipDetectItem[] =>
  rows.map((row) => {
    const { grup, field } = parseRecordLocation(row.signature, row.path);
    return {
      id: row.string_id,
      source: row.source,
      grup,
      edid: row.edid,
      field,
      path: row.path,
      context: row.context,
    };
  });

const mergeLlmSkipHits = (
  hits: Map<number, LlmSkipDetectCandidate>,
  llmHits: readonly LlmSkipDetectItemResult[],
  rows: Map<number, ScanStringRow>,
): void => {
  for (const llmHit of llmHits) {
    const row = rows.get(llmHit.id);
    if (!row) continue;
    const existing = hits.get(llmHit.id);
    hits.set(llmHit.id, {
      stringId: llmHit.id,
      source: row.source,
      signature: row.signature,
      path: row.path,
      edid: row.edid,
      reason: llmHit.reason,
      confidence: llmHit.confidence,
      method: existing ? 'both' : 'llm',
    });
  }
};

const enqueueSoloSkipDetectRows = (
  llmItems: readonly LlmSkipDetectItem[],
  rows: Map<number, ScanStringRow>,
  enqueueSplit: (parts: readonly (readonly ScanStringRow[])[]) => void,
): void => {
  const scanRows = llmItems
    .map((item) => rows.get(item.id))
    .filter((row): row is ScanStringRow => row != null);
  enqueueSoloChunks(scanRows, enqueueSplit);
};

const processChunk = async (
  chunk: readonly ScanStringRow[],
  opts: RunModSkipDetectPipelineOpts,
  enqueueSplit?: (parts: readonly (readonly ScanStringRow[])[]) => void,
): Promise<LlmSkipDetectCandidate[]> => {
  const useLlm = opts.useLlm === true;
  const shouldCancel = opts.shouldCancel;
  const rows = rowById(chunk);

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
  const hits = new Map<number, LlmSkipDetectCandidate>();

  for (const row of chunk) {
    const heuristic = heuristicHits.get(row.string_id);
    if (!heuristic) continue;
    hits.set(row.string_id, {
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

  const llmRows = chunk.filter((row) => !heuristicHits.has(row.string_id));
  if (useLlm && llmRows.length > 0 && !shouldCancel?.()) {
    const model = getTranslateModel();
    const items = toLlmItems(llmRows);

    for (let i = 0; i < items.length; i += SKIP_DETECT_LLM_BATCH_SIZE) {
      if (shouldCancel?.()) break;
      const batch = items.slice(i, i + SKIP_DETECT_LLM_BATCH_SIZE);

      await runLlmChunkWithRecovery({
        chunk: batch,
        shouldAbort: shouldCancel,
        enqueueSplit: enqueueSplit
          ? (parts) => {
              for (const part of parts) {
                enqueueSoloSkipDetectRows(part, rows, enqueueSplit);
              }
            }
          : undefined,
        runOnce: async (llmItems) => {
          try {
            const llmHits = await withRequestDeadline(
              CONFIG.llmRequestTimeoutMs,
              opts.signal,
              (signal) =>
                detectSkipCandidatesWithLlm({
                  items: [...llmItems],
                  model,
                  srcLang: opts.srcLang,
                  game: opts.game,
                  modName: opts.modName,
                  signal,
                }),
            );
            mergeLlmSkipHits(hits, llmHits, rows);
          } catch (err) {
            if (isLlmSkipDetectMissingIdsError(err)) {
              mergeLlmSkipHits(hits, err.partialResults, rows);
              const missingItems = llmItems.filter((item) => err.missingIds.includes(item.id));
              logVerify.warn('partial LLM skip-detect batch — solo retry for missing rows', {
                ok: llmItems.length - missingItems.length,
                missing: missingItems.map((item) => item.id),
              });
              if (enqueueSplit) {
                enqueueSoloSkipDetectRows(missingItems, rows, enqueueSplit);
              }
              return;
            }
            if (isLlmTimeoutError(err) && llmItems.length > 1) {
              logVerify.warn('LLM skip-detect batch timeout — solo retry', {
                chunkSize: llmItems.length,
                itemIds: llmItems.map((item) => item.id),
              });
              if (enqueueSplit) {
                enqueueSoloSkipDetectRows(llmItems, rows, enqueueSplit);
              }
              return;
            }
            throw err;
          }
        },
        shouldSplit: (err) => isLlmSkipDetectMissingIdsError(err) || isLlmTimeoutError(err),
        onFailure: (failed, message) => {
          logVerify.warn('skip-detect LLM batch skipped after error', {
            modId: opts.modId,
            error: message,
            stringIds: failed.map((item) => item.id),
          });
        },
        log: logVerify,
        operation: 'skip_detect',
        itemIds: (c) => c.map((item) => item.id),
      });
    }
  }

  return [...hits.values()];
};

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
    useLlm,
    persist,
    force,
    dbChunkSize,
    workers,
    llmBatchSize: useLlm ? SKIP_DETECT_LLM_BATCH_SIZE : null,
    srcLang: opts.srcLang,
  });

  async function* chunkFeed(): AsyncGenerator<readonly ScanStringRow[]> {
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
      const candidates = await processChunk(chunk, opts, enqueueSplit);
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

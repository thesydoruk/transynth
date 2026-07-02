/**
 * In-memory non-translatable string detection jobs.
 */
import type { Tx } from '../db';
import { CONFIG, getTranslateModel } from '../config';
import { detectSkipCandidatesWithLlm, type LlmSkipDetectItem } from '../llm/skipTranslateDetect';
import { partitionSkipAuditRows } from '../llm/skipTranslateHeuristics';
import { markStringsAsSkip, markStringsSkipDetectScanned } from './queries';
import { parseRecordLocation } from '../utils/recordLocation';
import { runPoolOverAsyncIterable } from '../utils/concurrency';
import { runLlmChunkWithRecovery } from '../llm/chunkRecovery';
import { withRequestDeadline } from '../llm/requestDeadline';
import { llmChatPipelineConcurrency } from '../llm/requestPool';
import { logVerify } from '../logging/loggers';

export const LLM_SKIP_DETECT_DB_CHUNK_SIZE = 500;

/** Rows per LLM HTTP request — defaults to BATCH_SIZE (skip-detect has no RAG; batching is safe). */
export const LLM_SKIP_DETECT_LLM_BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.LLM_SKIP_DETECT_BATCH_SIZE || String(CONFIG.batchSize), 10),
);

export type LlmSkipDetectCandidate = {
  stringId: number;
  source: string;
  signature: string | null;
  path: string | null;
  edid: string | null;
  reason: string;
  confidence: number;
  method: 'heuristic' | 'llm' | 'both';
};

export type LlmSkipDetectJobStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export type LlmSkipDetectJobSnapshot = {
  jobId: number;
  modId: number;
  status: LlmSkipDetectJobStatus;
  done: number;
  total: number;
  candidates: LlmSkipDetectCandidate[];
  /** Rows written to DB as skip when {@link runLlmSkipDetectJob} `persist` is enabled. */
  markedCount: number;
  error: string | null;
};

type ActiveLlmSkipDetectJob = LlmSkipDetectJobSnapshot & {
  cancel: boolean;
  srcLang: string;
  useLlm: boolean;
  persist: boolean;
  force: boolean;
  /** Aborts in-flight LLM requests the instant Stop is pressed. */
  abort: AbortController;
};

const activeJobs = new Map<number, ActiveLlmSkipDetectJob>();
let nextJobId = 1;

const toSnapshot = (job: ActiveLlmSkipDetectJob): LlmSkipDetectJobSnapshot => ({
  jobId: job.jobId,
  modId: job.modId,
  status: job.status,
  done: job.done,
  total: job.total,
  candidates: job.candidates,
  markedCount: job.markedCount,
  error: job.error,
});

export const getLlmSkipDetectJob = (jobId: number): LlmSkipDetectJobSnapshot | null => {
  const job = activeJobs.get(jobId);
  return job ? toSnapshot(job) : null;
};

export const findRunningLlmSkipDetectJob = (modId: number): number | null => {
  for (const job of activeJobs.values()) {
    if (job.modId === modId && job.status === 'running') return job.jobId;
  }
  return null;
};

export const requestLlmSkipDetectStop = (jobId: number): boolean => {
  const job = activeJobs.get(jobId);
  if (!job || job.status !== 'running') return false;
  job.cancel = true;
  job.abort.abort();
  return true;
};

export const requestLlmSkipDetectStopByModId = (modId: number): boolean => {
  const jobId = findRunningLlmSkipDetectJob(modId);
  if (jobId == null) return false;
  return requestLlmSkipDetectStop(jobId);
};

const scannableFilterSql = (force: boolean): string =>
  force ? '' : 'AND s.is_ignored = FALSE AND s.skip_detect_scanned_at IS NULL';

const countScannableStrings = async (
  db: Tx,
  modId: number,
  srcLang: string,
  force: boolean,
): Promise<number> => {
  const { rows } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM strings s
       JOIN records r ON r.id = s.record_id
      WHERE r.mod_id = $1
        AND s.lang = $2
        ${scannableFilterSql(force)}`,
    [modId, srcLang],
  );
  return Number.parseInt(rows[0]?.cnt ?? '0', 10);
};

type ScanStringRow = {
  string_id: number;
  source: string;
  signature: string | null;
  path: string | null;
  edid: string | null;
  context: string | null;
};

const loadScanChunk = async (
  db: Tx,
  modId: number,
  srcLang: string,
  afterId: number,
  limit: number,
  force: boolean,
): Promise<ScanStringRow[]> => {
  const { rows } = await db.query<ScanStringRow>(
    `SELECT s.id AS string_id,
            s.text_raw AS source,
            r.signature,
            r.path,
            r.edid,
            s.context
       FROM strings s
       JOIN records r ON r.id = s.record_id
      WHERE r.mod_id = $1
        AND s.lang = $2
        AND s.id > $3
        ${scannableFilterSql(force)}
      ORDER BY s.id
      LIMIT $4`,
    [modId, srcLang, afterId, limit],
  );
  return rows;
};

export type SkipDetectWorkUnit = {
  page: number;
  chunk: ScanStringRow[];
};

/** Stream scan work units — workers pull rows as they free up (no DB-page barrier). */
export async function* iterateSkipDetectWorkUnits(
  db: Tx,
  opts: {
    modId: number;
    srcLang: string;
    force: boolean;
    dbChunkSize?: number;
  },
): AsyncGenerator<SkipDetectWorkUnit> {
  let afterId = 0;
  let page = 0;
  const dbChunkSize = opts.dbChunkSize ?? LLM_SKIP_DETECT_DB_CHUNK_SIZE;

  let nextChunkPromise: Promise<ScanStringRow[]> = loadScanChunk(
    db,
    opts.modId,
    opts.srcLang,
    afterId,
    dbChunkSize,
    opts.force,
  );

  while (nextChunkPromise) {
    const dbChunk = await nextChunkPromise;
    if (dbChunk.length === 0) break;

    const lastId = dbChunk[dbChunk.length - 1]!.string_id;
    page++;
    afterId = lastId;

    nextChunkPromise =
      dbChunk.length >= dbChunkSize
        ? loadScanChunk(db, opts.modId, opts.srcLang, lastId, dbChunkSize, opts.force)
        : Promise.resolve([]);

    for (let i = 0; i < dbChunk.length; i += LLM_SKIP_DETECT_LLM_BATCH_SIZE) {
      yield { page, chunk: dbChunk.slice(i, i + LLM_SKIP_DETECT_LLM_BATCH_SIZE) };
    }
  }
}

export type LlmSkipDetectProgressEvent =
  | { type: 'started'; jobId: number; total: number; useLlm: boolean; persist: boolean }
  | {
      type: 'progress';
      done: number;
      total: number;
      candidate?: LlmSkipDetectCandidate;
      marked?: number;
    }
  | {
      type: 'done';
      done: number;
      total: number;
      candidates: LlmSkipDetectCandidate[];
      markedCount: number;
    }
  | {
      type: 'cancelled';
      done: number;
      total: number;
      candidates: LlmSkipDetectCandidate[];
      markedCount: number;
    }
  | { type: 'error'; error: string };

export const runLlmSkipDetectJob = async (
  db: Tx,
  opts: {
    modId: number;
    srcLang: string;
    modName?: string | null;
    game?: string | null;
    useLlm?: boolean;
    /** Write skip marks to the database after each batch (default: false). */
    persist?: boolean;
    /** Re-scan all strings, including already marked skip or previously scanned (default: false). */
    force?: boolean;
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
  const total = await countScannableStrings(db, opts.modId, opts.srcLang, force);
  if (total === 0) {
    throw new Error('No strings to scan');
  }

  const jobId = nextJobId++;
  const job: ActiveLlmSkipDetectJob = {
    jobId,
    modId: opts.modId,
    status: 'running',
    done: 0,
    total,
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
  activeJobs.set(jobId, job);

  logVerify.info('skip-detect job started', {
    jobId,
    modId: opts.modId,
    total,
    useLlm,
    persist,
    force,
    srcLang: opts.srcLang,
    llmBatchSize: LLM_SKIP_DETECT_LLM_BATCH_SIZE,
  });

  onEvent({ type: 'started', jobId, total, useLlm, persist });

  const model = getTranslateModel();
  const chatConcurrency = llmChatPipelineConcurrency();

  const persistCandidates = async (candidates: LlmSkipDetectCandidate[]): Promise<number> => {
    if (!persist || candidates.length === 0) return 0;
    const marked = await markStringsAsSkip(
      db,
      candidates.map((c) => c.stringId),
    );
    job.markedCount += marked;
    logVerify.info('skip-detect chunk persisted', {
      jobId,
      modId: opts.modId,
      marked,
      markedTotal: job.markedCount,
    });
    return marked;
  };

  const finishRows = async (
    rows: ScanStringRow[],
    hits: Map<number, LlmSkipDetectCandidate>,
  ): Promise<void> => {
    if (rows.length === 0) return;

    const toPersist: LlmSkipDetectCandidate[] = [];
    for (const row of rows) {
      job.done++;
      const candidate = hits.get(row.string_id);
      if (candidate) {
        job.candidates.push(candidate);
        toPersist.push(candidate);
      }
      onEvent({
        type: 'progress',
        done: job.done,
        total: job.total,
        ...(candidate ? { candidate } : {}),
      });
    }

    if (persist && toPersist.length > 0) {
      await persistCandidates(toPersist);
    }
  };

  const processScanChunk = async (chunk: ScanStringRow[]): Promise<void> => {
    if (job.cancel || chunk.length === 0) return;

    const hits = new Map<number, LlmSkipDetectCandidate>();

    const auditRows = chunk.map((row) => {
      const { grup } = parseRecordLocation(row.signature, row.path);
      return {
        id: row.string_id,
        source: row.source,
        edid: row.edid,
        path: row.path,
        signature: grup,
      };
    });

    const { heuristicHits, llmCandidates } = partitionSkipAuditRows(auditRows);

    for (const row of chunk) {
      const heuristic = heuristicHits.get(row.string_id);
      if (heuristic) {
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
    }

    const heuristicRows = chunk.filter((row) => heuristicHits.has(row.string_id));
    const llmRows = chunk.filter((row) => !heuristicHits.has(row.string_id));

    if (heuristicRows.length > 0 && !job.cancel) {
      await finishRows(heuristicRows, hits);
      await markStringsSkipDetectScanned(
        db,
        heuristicRows.map((row) => row.string_id),
      );
    }

    if (useLlm && !job.cancel && llmCandidates.length > 0) {
      const items: LlmSkipDetectItem[] = llmRows.map((row) => {
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

      await runLlmChunkWithRecovery({
        chunk: items,
        shouldAbort: () => job.cancel,
        runOnce: async (llmItems) => {
          const llmHits = await withRequestDeadline(
            CONFIG.llmVerifyRequestTimeoutMs,
            job.abort.signal,
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

          for (const llmHit of llmHits) {
            const row = chunk.find((r) => r.string_id === llmHit.id);
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
        },
        onFailure: (failed, message) => {
          logVerify.warn('skip-detect LLM chunk skipped after error', {
            jobId,
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

    if (llmRows.length > 0 && !job.cancel) {
      await finishRows(llmRows, hits);
      await markStringsSkipDetectScanned(
        db,
        llmRows.map((row) => row.string_id),
      );
    }
  };

  try {
    await runPoolOverAsyncIterable(
      iterateSkipDetectWorkUnits(db, {
        modId: opts.modId,
        srcLang: opts.srcLang,
        force,
      }),
      chatConcurrency,
      async ({ chunk }) => {
        if (job.cancel) return;
        await processScanChunk(chunk);
      },
    );

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

  return toSnapshot(job);
};

export const scheduleLlmSkipDetectJobCleanup = (jobId: number, delayMs = 60_000): void => {
  setTimeout(() => {
    const job = activeJobs.get(jobId);
    if (job && job.status !== 'running') {
      activeJobs.delete(jobId);
    }
  }, delayMs);
};

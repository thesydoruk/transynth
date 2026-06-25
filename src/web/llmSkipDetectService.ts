/**
 * In-memory non-translatable string detection jobs.
 */
import type { Tx } from '../db';
import { CONFIG, getTranslateModel } from '../config';
import { detectSkipCandidatesWithLlm, type LlmSkipDetectItem } from '../llm/skipTranslateDetect';
import { partitionSkipAuditRows } from '../llm/skipTranslateHeuristics';
import { markStringsAsSkip } from './queries';
import { parseRecordLocation } from '../utils/recordLocation';
import { mapWithConcurrency } from '../utils/concurrency';
import { logVerify } from '../logging/loggers';

export const LLM_SKIP_DETECT_DB_CHUNK_SIZE = 200;

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
  targetLang: string;
  useLlm: boolean;
  persist: boolean;
  force: boolean;
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
  return true;
};

export const requestLlmSkipDetectStopByModId = (modId: number): boolean => {
  const jobId = findRunningLlmSkipDetectJob(modId);
  if (jobId == null) return false;
  return requestLlmSkipDetectStop(jobId);
};

const scannableFilterSql = (force: boolean): string => (force ? '' : 'AND s.is_ignored = FALSE');

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
    targetLang: string;
    modName?: string | null;
    game?: string | null;
    useLlm?: boolean;
    /** Write skip marks to the database after each DB chunk (default: false). */
    persist?: boolean;
    /** Re-scan strings already marked skip (default: false). */
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
    targetLang: opts.targetLang,
    useLlm,
    persist,
    force,
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
    targetLang: opts.targetLang,
  });

  onEvent({ type: 'started', jobId, total, useLlm, persist });

  const model = getTranslateModel();
  let afterId = 0;

  const persistChunkCandidates = async (candidates: LlmSkipDetectCandidate[]): Promise<number> => {
    if (!persist || candidates.length === 0) return 0;
    const marked = await markStringsAsSkip(
      db,
      candidates.map((c) => c.stringId),
      opts.targetLang,
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

  try {
    while (!job.cancel) {
      const dbChunk = await loadScanChunk(
        db,
        opts.modId,
        opts.srcLang,
        afterId,
        LLM_SKIP_DETECT_DB_CHUNK_SIZE,
        force,
      );
      if (dbChunk.length === 0) break;
      afterId = dbChunk[dbChunk.length - 1]!.string_id;

      const llmChunks: ScanStringRow[][] = [];
      for (let i = 0; i < dbChunk.length; i += CONFIG.batchSize) {
        llmChunks.push(dbChunk.slice(i, i + CONFIG.batchSize));
      }

      type ChunkOutcome =
        | { ok: true; hits: Map<number, LlmSkipDetectCandidate> }
        | { ok: true; skipped: number }
        | { ok: false; error: string; rowCount: number };

      const skipChunk = (size: number): ChunkOutcome => ({ ok: true, skipped: size });

      const chunkOutcomes = await mapWithConcurrency(
        llmChunks,
        CONFIG.llmMaxParallel,
        async (chunk): Promise<ChunkOutcome> => {
          if (job.cancel) return skipChunk(chunk.length);

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

          if (useLlm && !job.cancel && llmCandidates.length > 0) {
            const llmCandidateIds = new Set(llmCandidates.map((r) => r.id));
            const items: LlmSkipDetectItem[] = chunk
              .filter((row) => llmCandidateIds.has(row.string_id))
              .map((row) => {
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

            try {
              const llmHits = await detectSkipCandidatesWithLlm({
                items,
                model,
                srcLang: opts.srcLang,
                targetLang: opts.targetLang,
                game: opts.game,
                modName: opts.modName,
              });

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
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              logVerify.warn('skip-detect LLM chunk skipped after error', {
                jobId,
                modId: opts.modId,
                error: message,
                stringIds: items.map((item) => item.id),
              });
            }
          }

          return { ok: true, hits };
        },
      );

      const dbChunkCandidates: LlmSkipDetectCandidate[] = [];

      for (let chunkIdx = 0; chunkIdx < chunkOutcomes.length; chunkIdx++) {
        const outcome = chunkOutcomes[chunkIdx];
        const chunk = llmChunks[chunkIdx] ?? [];

        if (outcome.ok && 'skipped' in outcome) {
          for (let i = 0; i < outcome.skipped; i++) {
            job.done++;
            onEvent({ type: 'progress', done: job.done, total: job.total });
          }
          continue;
        }

        if (!outcome.ok) {
          logVerify.warn('skip-detect chunk failed unexpectedly', {
            jobId,
            modId: opts.modId,
            error: outcome.error,
          });
          for (let i = 0; i < outcome.rowCount; i++) {
            job.done++;
            onEvent({ type: 'progress', done: job.done, total: job.total });
          }
          continue;
        }

        for (const row of chunk) {
          job.done++;
          const candidate = outcome.hits.get(row.string_id);
          if (candidate) {
            job.candidates.push(candidate);
            dbChunkCandidates.push(candidate);
            onEvent({ type: 'progress', done: job.done, total: job.total, candidate });
          } else {
            onEvent({ type: 'progress', done: job.done, total: job.total });
          }
        }
      }

      const marked = await persistChunkCandidates(dbChunkCandidates);
      if (marked > 0) {
        onEvent({
          type: 'progress',
          done: job.done,
          total: job.total,
          marked,
        });
      }
    }

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

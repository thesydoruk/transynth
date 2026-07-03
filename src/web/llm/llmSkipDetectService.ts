/**
 * Non-translatable string detection jobs (heuristics + optional LLM audit).
 */
import type { Tx } from '../../db';
import { CONFIG, DB_CHUNK_SIZE } from '../../config';
import { logVerify } from '../../logging/loggers';
import { resetModSkipDetectState } from '../data/queries';
import { runModSkipDetectPipeline } from './skipDetectPipeline';

/** Rows fetched from the database per pagination step (see CONFIG.dbChunkSize). */
export const SKIP_DETECT_DB_CHUNK_SIZE = DB_CHUNK_SIZE;

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

export const countScannableStrings = async (
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

export type ScanStringRow = {
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

/** Stream scan chunks from the DB — prefetches the next page while workers drain the current one. */
export async function* iterateSkipDetectWorkUnits(
  db: Tx,
  opts: {
    modId: number;
    srcLang: string;
    force: boolean;
    dbChunkSize?: number;
    /** Split each DB page into smaller worker batches (e.g. LLM batch size). */
    processBatchSize?: number;
  },
): AsyncGenerator<SkipDetectWorkUnit> {
  let afterId = 0;
  let page = 0;
  const dbChunkSize = Math.max(50, opts.dbChunkSize ?? DB_CHUNK_SIZE);
  const processBatchSize = opts.processBatchSize;

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

    if (processBatchSize != null && processBatchSize > 0) {
      for (let i = 0; i < dbChunk.length; i += processBatchSize) {
        yield { page, chunk: dbChunk.slice(i, i + processBatchSize) };
      }
    } else {
      yield { page, chunk: dbChunk };
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
      candidatesBatch?: LlmSkipDetectCandidate[];
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

  const jobId = nextJobId++;
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
  activeJobs.set(jobId, job);

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
      activeJobs.delete(jobId);
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
        collectCandidate: (candidate) => {
          job.candidates.push(candidate);
        },
        onProgress: (progress) => {
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

/** @deprecated Use {@link SKIP_DETECT_DB_CHUNK_SIZE}. */
export const LLM_SKIP_DETECT_DB_CHUNK_SIZE = SKIP_DETECT_DB_CHUNK_SIZE;

/** @deprecated Processing uses full DB pages; kept for CLI compatibility. */
export const SKIP_DETECT_PROCESS_BATCH_SIZE = SKIP_DETECT_DB_CHUNK_SIZE;

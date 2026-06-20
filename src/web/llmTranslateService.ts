/**
 * In-memory mod-wide LLM translation jobs.
 *
 * Jobs are not persisted — they are lost on worker restart by design.
 */
import type { Tx } from '../db';
import { translateStringIdsBatch } from './llmTranslateBatch';
import { logTranslate } from '../logging/loggers';

/** String IDs fetched from the database per pagination step. */
export const LLM_TRANSLATE_DB_CHUNK_SIZE = 100;

export type LlmTranslateRow = {
  stringId: number;
  source: string;
  translation: string | null;
  signature: string | null;
  path: string | null;
  edid: string | null;
  error: string | null;
};

export type LlmTranslateJobStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export type LlmTranslateJobSnapshot = {
  jobId: number;
  modId: number;
  status: LlmTranslateJobStatus;
  done: number;
  total: number;
  rows: LlmTranslateRow[];
  error: string | null;
};

type ActiveLlmTranslateJob = LlmTranslateJobSnapshot & {
  cancel: boolean;
  srcLang: string;
  targetLang: string;
};

const activeJobs = new Map<number, ActiveLlmTranslateJob>();
let nextJobId = 1;

const toSnapshot = (job: ActiveLlmTranslateJob): LlmTranslateJobSnapshot => ({
  jobId: job.jobId,
  modId: job.modId,
  status: job.status,
  done: job.done,
  total: job.total,
  rows: job.rows,
  error: job.error,
});

export const getLlmTranslateJob = (jobId: number): LlmTranslateJobSnapshot | null => {
  const job = activeJobs.get(jobId);
  return job ? toSnapshot(job) : null;
};

export const findRunningLlmTranslateJob = (modId: number): number | null => {
  for (const job of activeJobs.values()) {
    if (job.modId === modId && job.status === 'running') return job.jobId;
  }
  return null;
};

export const requestLlmTranslateStop = (jobId: number): boolean => {
  const job = activeJobs.get(jobId);
  if (!job || job.status !== 'running') return false;
  job.cancel = true;
  return true;
};

const countUntranslatedStrings = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<number> => {
  const { rows } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM strings s
       JOIN records r ON r.id = s.record_id
      WHERE r.mod_id = $1
        AND s.lang = $2
        AND NOT EXISTS (
          SELECT 1 FROM translations t
           WHERE t.src_string_id = s.id AND t.target_lang = $3
        )`,
    [modId, srcLang, targetLang],
  );
  return Number.parseInt(rows[0]?.cnt ?? '0', 10);
};

type UntranslatedMetaRow = {
  string_id: number;
  source: string;
  signature: string | null;
  path: string | null;
  edid: string | null;
};

const loadUntranslatedChunk = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
  offset: number,
  limit: number,
): Promise<UntranslatedMetaRow[]> => {
  const { rows } = await db.query<UntranslatedMetaRow>(
    `SELECT s.id AS string_id,
            s.text_raw AS source,
            r.signature,
            r.path,
            r.edid
       FROM strings s
       JOIN records r ON r.id = s.record_id
      WHERE r.mod_id = $1
        AND s.lang = $2
        AND NOT EXISTS (
          SELECT 1 FROM translations t
           WHERE t.src_string_id = s.id AND t.target_lang = $3
        )
      ORDER BY s.id
      LIMIT $4 OFFSET $5`,
    [modId, srcLang, targetLang, limit, offset],
  );
  return rows;
};

export type LlmTranslateProgressEvent =
  | { type: 'started'; jobId: number; total: number }
  | { type: 'progress'; done: number; total: number; row?: LlmTranslateRow }
  | { type: 'done'; done: number; total: number; rows: LlmTranslateRow[] }
  | { type: 'cancelled'; done: number; total: number; rows: LlmTranslateRow[] }
  | { type: 'error'; error: string };

export const runLlmTranslateJob = async (
  db: Tx,
  opts: {
    modId: number;
    srcLang: string;
    targetLang: string;
    modName?: string | null;
    game?: string | null;
  },
  onEvent: (event: LlmTranslateProgressEvent) => void,
): Promise<LlmTranslateJobSnapshot> => {
  const runningJobId = findRunningLlmTranslateJob(opts.modId);
  if (runningJobId != null) {
    throw new Error(`LLM translate already running for mod ${opts.modId} (job #${runningJobId})`);
  }

  const total = await countUntranslatedStrings(db, opts.modId, opts.srcLang, opts.targetLang);
  if (total === 0) {
    throw new Error('No untranslated strings to translate');
  }

  const jobId = nextJobId++;
  const job: ActiveLlmTranslateJob = {
    jobId,
    modId: opts.modId,
    status: 'running',
    done: 0,
    total,
    rows: [],
    error: null,
    cancel: false,
    srcLang: opts.srcLang,
    targetLang: opts.targetLang,
  };
  activeJobs.set(jobId, job);

  logTranslate.info('job started', {
    jobId,
    modId: opts.modId,
    total,
    srcLang: opts.srcLang,
    targetLang: opts.targetLang,
    modName: opts.modName ?? null,
  });

  onEvent({ type: 'started', jobId, total });

  let dbOffset = 0;

  try {
    while (dbOffset < total && !job.cancel) {
      const dbChunk = await loadUntranslatedChunk(
        db,
        opts.modId,
        opts.srcLang,
        opts.targetLang,
        dbOffset,
        LLM_TRANSLATE_DB_CHUNK_SIZE,
      );
      if (dbChunk.length === 0) break;
      dbOffset += dbChunk.length;

      const metaById = new Map(dbChunk.map((row) => [row.string_id, row]));
      const stringIds = dbChunk.map((row) => row.string_id);

      try {
        await translateStringIdsBatch(db, stringIds, {
          srcLang: opts.srcLang,
          targetLang: opts.targetLang,
          modGame: opts.game,
          modName: opts.modName,
          shouldCancel: () => job.cancel,
          onProgress: (doneInBatch, _batchTotal, result) => {
            job.done++;
            const meta = metaById.get(result.stringId);
            const row: LlmTranslateRow = {
              stringId: result.stringId,
              source: meta?.source ?? '',
              translation: result.text ?? null,
              signature: meta?.signature ?? null,
              path: meta?.path ?? null,
              edid: meta?.edid ?? null,
              error: result.error ?? null,
            };
            job.rows.push(row);
            onEvent({ type: 'progress', done: job.done, total: job.total, row });
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logTranslate.error('job chunk failed', { err, jobId, modId: opts.modId });
        job.status = 'failed';
        job.error = message;
        onEvent({ type: 'error', error: message });
        return toSnapshot(job);
      }
    }

    if (job.cancel) {
      job.status = 'cancelled';
      logTranslate.info('job cancelled', { jobId, done: job.done, total: job.total });
      onEvent({
        type: 'cancelled',
        done: job.done,
        total: job.total,
        rows: job.rows,
      });
    } else {
      job.status = 'completed';
      logTranslate.info('job completed', { jobId, done: job.done, total: job.total });
      onEvent({
        type: 'done',
        done: job.done,
        total: job.total,
        rows: job.rows,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.error = message;
    logTranslate.error('job failed', { jobId, error: message, err });
    onEvent({ type: 'error', error: message });
  }

  return toSnapshot(job);
};

export const scheduleLlmTranslateJobCleanup = (jobId: number, delayMs = 60_000): void => {
  setTimeout(() => {
    const job = activeJobs.get(jobId);
    if (job && job.status !== 'running') {
      activeJobs.delete(jobId);
    }
  }, delayMs);
};

/**
 * Mod-wide LLM translation job body (runs inside the worker).
 *
 * Cancellation and job id come from the BullMQ JobContext — no process-local
 * registry. Progress snapshots for reopened modals live in Redis.
 */
import type { Tx } from '../../db';
import { DB_CHUNK_SIZE } from '../../config';
import { llmTranslateEligibilitySql, type LlmTranslateOverwriteMode } from '../data/queries';
import { translateStringIdsBatch } from './translateBatch';
import { logTranslate } from '../../logging/loggers';
import { awaitPendingQaRefresh } from '../services/qaHooks';

/**
 * String IDs fetched from the database per pagination step.
 *
 * Default from `DB_CHUNK_SIZE` env (5000). Override via `--db-chunk` on the CLI.
 */
export const LLM_TRANSLATE_DB_CHUNK_SIZE = DB_CHUNK_SIZE;

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

export type { LlmTranslateOverwriteMode } from '../data/queries';

/** Statuses that must not be overwritten unless `--force-all`. */
export const LLM_TRANSLATE_VERIFIED_STATUSES = ['reviewed', 'human', 'rejected'] as const;

export const countUntranslatedStrings = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
  overwriteMode: LlmTranslateOverwriteMode = 'default',
): Promise<number> => {
  const { rows } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM strings s
       JOIN records r ON r.id = s.record_id
       LEFT JOIN translations t
         ON t.src_string_id = s.id AND t.target_lang = $3
      WHERE r.mod_id = $1
        AND s.lang = $2
        AND s.is_ignored = FALSE
        AND ${llmTranslateEligibilitySql(overwriteMode)}`,
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

/**
 * Load the next page of strings eligible for LLM translate.
 * Cursor-based pagination (`afterStringId`) — safe for force re-translate too.
 */
export const loadUntranslatedChunk = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
  afterStringId: number,
  limit: number,
  overwriteMode: LlmTranslateOverwriteMode = 'default',
): Promise<UntranslatedMetaRow[]> => {
  const { rows } = await db.query<UntranslatedMetaRow>(
    `SELECT s.id AS string_id,
            s.text_raw AS source,
            r.signature,
            r.path,
            r.edid
       FROM strings s
       JOIN records r ON r.id = s.record_id
       LEFT JOIN translations t
         ON t.src_string_id = s.id AND t.target_lang = $3
      WHERE r.mod_id = $1
        AND s.lang = $2
        AND s.is_ignored = FALSE
        AND s.id > $5
        AND ${llmTranslateEligibilitySql(overwriteMode)}
      ORDER BY s.id
      LIMIT $4`,
    [modId, srcLang, targetLang, limit, afterStringId],
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
    jobId: number;
    modId: number;
    srcLang: string;
    targetLang: string;
    modName?: string | null;
    game?: string | null;
    signal: AbortSignal;
    isCancelled: () => boolean;
  },
  onEvent: (event: LlmTranslateProgressEvent) => void,
): Promise<LlmTranslateJobSnapshot> => {
  const { jobId, modId } = opts;
  const total = await countUntranslatedStrings(db, modId, opts.srcLang, opts.targetLang);
  if (total === 0) {
    throw new Error('No untranslated strings to translate');
  }

  let done = 0;
  const rows: LlmTranslateRow[] = [];
  let status: LlmTranslateJobStatus = 'running';
  let error: string | null = null;

  const snapshot = (): LlmTranslateJobSnapshot => ({
    jobId,
    modId,
    status,
    done,
    total,
    rows,
    error,
  });

  logTranslate.info('job started', {
    jobId,
    modId,
    total,
    srcLang: opts.srcLang,
    targetLang: opts.targetLang,
    modName: opts.modName ?? null,
  });

  onEvent({ type: 'started', jobId, total });

  let afterStringId = 0;

  try {
    while (!opts.isCancelled()) {
      const dbChunk = await loadUntranslatedChunk(
        db,
        modId,
        opts.srcLang,
        opts.targetLang,
        afterStringId,
        LLM_TRANSLATE_DB_CHUNK_SIZE,
      );
      if (dbChunk.length === 0) break;
      afterStringId = dbChunk[dbChunk.length - 1]!.string_id;

      const metaById = new Map(dbChunk.map((row) => [row.string_id, row]));
      const stringIds = dbChunk.map((row) => row.string_id);

      try {
        await translateStringIdsBatch(db, stringIds, {
          srcLang: opts.srcLang,
          targetLang: opts.targetLang,
          modGame: opts.game,
          modName: opts.modName,
          overwriteMode: 'default',
          shouldCancel: opts.isCancelled,
          signal: opts.signal,
          onProgress: (_doneInBatch, _batchTotal, result) => {
            done++;
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
            rows.push(row);
            onEvent({ type: 'progress', done, total, row });
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logTranslate.error('job chunk failed; continuing with next chunk', {
          err,
          jobId,
          modId,
          stringIds,
        });
        for (const stringId of stringIds) {
          done++;
          const meta = metaById.get(stringId);
          const row: LlmTranslateRow = {
            stringId,
            source: meta?.source ?? '',
            translation: null,
            signature: meta?.signature ?? null,
            path: meta?.path ?? null,
            edid: meta?.edid ?? null,
            error: message,
          };
          rows.push(row);
          onEvent({ type: 'progress', done, total, row });
        }
      }
    }

    if (!opts.isCancelled()) {
      await awaitPendingQaRefresh();
    }

    if (opts.isCancelled()) {
      status = 'cancelled';
      logTranslate.info('job cancelled', { jobId, done, total });
      onEvent({ type: 'cancelled', done, total, rows });
    } else {
      status = 'completed';
      logTranslate.info('job completed', { jobId, done, total });
      onEvent({ type: 'done', done, total, rows });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status = 'failed';
    error = message;
    logTranslate.error('job failed', { jobId, error: message, err });
    onEvent({ type: 'error', error: message });
  }

  return snapshot();
};

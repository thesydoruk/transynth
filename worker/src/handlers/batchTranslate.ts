/**
 * Editor batch translate (selected string ids, typically ≤100).
 *
 * Short-lived and not deduped per mod — several editor sessions can run at
 * once. The route inserts an `llm_jobs` history row; we finalize it here so
 * the job history UI stays accurate even if the SSE client disconnects.
 */
import { logTranslate } from '../../../src/logging/loggers';
import { translateStringIdsBatch } from '../../../src/web/llm/translateBatch';
import type { Tx } from '../../../src/db';
import type { JobHandler } from '../types';

export type BatchTranslateJobParams = {
  stringIds: number[];
  srcLang: string;
  targetLang: string;
  modGame: string | null;
  modName: string | null;
  /** `llm_jobs` history row inserted by the route; finalized here. */
  llmJobId: number | null;
};

type BatchResult = { stringId: number; text?: string; error?: string };

/** Persist the batch outcome onto the optional `llm_jobs` history row. */
const finalizeLlmJobRow = async (
  db: Tx,
  llmJobId: number,
  results: BatchResult[],
): Promise<void> => {
  const successCount = results.filter((r) => r.text !== undefined).length;
  const failed = results.some((r) => r.error !== undefined && r.text === undefined);
  const finalStatus = failed && successCount === 0 ? 'failed' : 'completed';
  const firstError = results.find((r) => r.error)?.error ?? null;
  try {
    await db.query(
      `UPDATE llm_jobs
          SET status = $1, done_count = $2, error = $3, updated_at = NOW()
        WHERE id = $4`,
      [finalStatus, successCount, firstError, llmJobId],
    );
  } catch (err) {
    logTranslate.warn('llm_jobs: failed to finalize job row', { err, llmJobId });
  }
};

export const batchTranslateHandler: JobHandler = async (db, ctx) => {
  const params = ctx.data.params as BatchTranslateJobParams;

  const results = (await translateStringIdsBatch(db, params.stringIds, {
    srcLang: params.srcLang,
    targetLang: params.targetLang,
    modGame: params.modGame,
    modName: params.modName,
    overwriteMode: 'force',
    shouldCancel: ctx.isCancelled,
    signal: ctx.signal,
    onProgress: (done, total, result) => {
      ctx.emit({ type: 'progress', done, total, result });
    },
  })) as BatchResult[];

  ctx.emit({ type: 'done', results });

  if (params.llmJobId != null) await finalizeLlmJobRow(db, params.llmJobId, results);

  return {
    status: ctx.isCancelled() ? 'cancelled' : 'completed',
    done: results.filter((r) => r.text !== undefined).length,
    total: params.stringIds.length,
  };
};

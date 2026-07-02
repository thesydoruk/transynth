/**
 * CLI-oriented mod translation — paginated DB reads, no in-memory job row accumulation.
 */
import type { Tx } from '../db';
import {
  LLM_TRANSLATE_DB_CHUNK_SIZE,
  countUntranslatedStrings,
  loadUntranslatedChunk,
} from './llmTranslateService';
import { translateStringIdsBatch, type TranslateBatchResult } from './llmTranslateBatch';
import { logTranslate } from '../logging/loggers';
import { awaitPendingQaRefresh } from './qaHooks';

export type CliTranslateProgressEvent =
  | { type: 'started'; total: number; dbChunkSize: number; force?: boolean }
  | {
      type: 'progress';
      done: number;
      total: number;
      ok: number;
      errors: number;
      dbPage: number;
      result?: TranslateBatchResult;
    }
  | { type: 'done'; done: number; total: number; ok: number; errors: number }
  | { type: 'error'; error: string };

export type CliTranslateResult = {
  done: number;
  total: number;
  ok: number;
  errors: number;
};

export const runCliModTranslate = async (
  db: Tx,
  opts: {
    modId: number;
    srcLang: string;
    targetLang: string;
    modName?: string | null;
    game?: string | null;
    dbChunkSize?: number;
    /** Re-translate existing auto/draft rows (never human/reviewed). */
    force?: boolean;
  },
  onEvent?: (event: CliTranslateProgressEvent) => void,
): Promise<CliTranslateResult> => {
  const dbChunkSize = Math.max(50, opts.dbChunkSize ?? LLM_TRANSLATE_DB_CHUNK_SIZE);
  const force = opts.force === true;
  const total = await countUntranslatedStrings(
    db,
    opts.modId,
    opts.srcLang,
    opts.targetLang,
    force,
  );
  if (total === 0) {
    throw new Error(
      force
        ? 'No translatable strings to translate (all skipped or human/reviewed)'
        : 'No untranslated strings to translate',
    );
  }

  logTranslate.info('cli translate started', {
    modId: opts.modId,
    total,
    dbChunkSize,
    force,
    srcLang: opts.srcLang,
    targetLang: opts.targetLang,
  });

  onEvent?.({ type: 'started', total, dbChunkSize, force });

  let afterStringId = 0;
  let globalDone = 0;
  let globalOk = 0;
  let globalErrors = 0;
  let dbPage = 0;

  try {
    while (true) {
      const dbChunk = await loadUntranslatedChunk(
        db,
        opts.modId,
        opts.srcLang,
        opts.targetLang,
        afterStringId,
        dbChunkSize,
        force,
      );
      if (dbChunk.length === 0) break;
      afterStringId = dbChunk[dbChunk.length - 1]!.string_id;
      dbPage++;

      const stringIds = dbChunk.map((row) => row.string_id);

      try {
        await translateStringIdsBatch(db, stringIds, {
          srcLang: opts.srcLang,
          targetLang: opts.targetLang,
          modGame: opts.game,
          modName: opts.modName,
          onProgress: (_doneInBatch, _batchTotal, result) => {
            globalDone++;
            if (result.error) globalErrors++;
            else if (result.text) globalOk++;
            onEvent?.({
              type: 'progress',
              done: globalDone,
              total,
              ok: globalOk,
              errors: globalErrors,
              dbPage,
              result,
            });
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logTranslate.error('cli translate chunk failed; continuing with next chunk', {
          modId: opts.modId,
          error: message,
          stringIds,
        });
        for (const stringId of stringIds) {
          globalDone++;
          globalErrors++;
          onEvent?.({
            type: 'progress',
            done: globalDone,
            total,
            ok: globalOk,
            errors: globalErrors,
            dbPage,
            result: { stringId, error: message },
          });
        }
      }
    }

    const summary = { done: globalDone, total, ok: globalOk, errors: globalErrors };
    await awaitPendingQaRefresh();
    logTranslate.info('cli translate completed', { modId: opts.modId, ...summary });
    onEvent?.({ type: 'done', ...summary });
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logTranslate.error('cli translate failed', { modId: opts.modId, error: message });
    onEvent?.({ type: 'error', error: message });
    throw err;
  }
};

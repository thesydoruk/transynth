/**
 * Shared batch LLM translation for a list of string IDs.
 */
import type { Tx } from '../../../../../src/db';
import { CONFIG, getTranslateModel } from '../../../../../src/config';
import { requirePgvectorForRag } from '../../../../../src/llm/rag';
import { getAllProjectSettings } from '../../../../../src/web/services/projectSettings';
import { bulkUpsertAutoTranslations } from '../../../../../src/web/import/modImportBulk';
import { filterStringIdsForLlmTranslate } from '../../../../../src/web/data/queries';
import {
  DIALOG_PARTICIPANT_COLUMNS,
  dialogParticipantsLateralSql,
} from '../../../../../src/web/data/queries/dialogs';
import { effectiveNarratorGenderSql } from '../../../../../src/dialog/narratorGender';
import { scheduleRefreshQAIssuesBatch } from '../../../../../src/web/services/qaHooks';
import { logTranslate } from '../../../../../src/logging/loggers';
import { clampRagMaxExamples } from '../../../../../src/llm/ragConstants';
import { runLlmChunkWorkPool } from '../../../../../src/llm/chunkRecovery';
import { llmChatPipelineConcurrency } from '../../../../../src/llm/requestPool';
import { buildLlmTranslateChunks } from '../chunking';
import { loadGlossaryForBatch } from './glossary';
import {
  chunkWorkPoolShouldSplit,
  createChunkTranslateContext,
  createPersistPool,
  drainPersistJobs,
  prefetchChunkRag,
  translateChunkOnce,
} from './chunkTranslate';
import { prepareLlmItems } from './prepareRows';
import type { StringRow, TranslateBatchOptions, TranslateBatchResult } from './types';

export type { TranslateBatchOptions, TranslateBatchResult } from './types';

/** Translate a batch of source string IDs via LLM (RAG, glossary). */
export const translateStringIdsBatch = async (
  db: Tx,
  stringIds: number[],
  opts: TranslateBatchOptions,
): Promise<TranslateBatchResult[]> => {
  if (stringIds.length === 0) return [];

  const {
    srcLang,
    targetLang,
    modGame,
    modName,
    overwriteMode = 'default',
    rag = {},
    shouldCancel,
    signal,
    onProgress,
  } = opts;
  const eligibleIds = await filterStringIdsForLlmTranslate(
    db,
    stringIds,
    targetLang,
    overwriteMode,
  );
  if (eligibleIds.length === 0) return [];

  logTranslate.info('batch start', {
    stringCount: eligibleIds.length,
    skippedProtected: stringIds.length - eligibleIds.length,
    srcLang,
    targetLang,
    modGame: modGame ?? null,
    modName: modName ?? null,
  });

  if (!rag.disableRag) {
    await requirePgvectorForRag(db);
  }

  const glossaryAll = await loadGlossaryForBatch(db, srcLang, targetLang);
  const projectSettings = await getAllProjectSettings(db);
  const ragMaxExamples = clampRagMaxExamples(projectSettings['llm.rag_max_examples']);
  const ragMinSimilarity = Math.min(1, Math.max(0, projectSettings['llm.rag_min_similarity']));

  const { rows: loadedRows } = await db.query<StringRow>(
    `SELECT s.id, s.text_raw, s.text_norm, s.text_norm_nopunct, s.context,
            r.signature, r.path, r.edid, r.formid_hex, m.game, m.name AS mod_name,
            ${effectiveNarratorGenderSql('r')} AS narrator_gender,
            ${DIALOG_PARTICIPANT_COLUMNS}
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN mods m ON m.id = r.mod_id
       LEFT JOIN LATERAL (${dialogParticipantsLateralSql('r')}
       ) dp ON TRUE
      WHERE s.id = ANY($1::int[]) AND s.lang = $2`,
    [eligibleIds, srcLang],
  );
  const rowById = new Map(loadedRows.map((row) => [row.id, row]));

  const results: TranslateBatchResult[] = [];
  let doneCount = 0;

  const emitResult = (r: TranslateBatchResult) => {
    results.push(r);
    doneCount++;
    onProgress?.(doneCount, eligibleIds.length, r);
  };

  const { pool: persistPool, jobs: persistJobs } = createPersistPool();

  const model = getTranslateModel();

  const persistAutoTranslationRows = async (
    rows: Array<{ stringId: number; text: string }>,
  ): Promise<void> => {
    if (rows.length === 0) return;
    await bulkUpsertAutoTranslations(
      db,
      rows.map((r) => ({ srcStringId: r.stringId, text: r.text })),
      targetLang,
      model,
    );
    scheduleRefreshQAIssuesBatch(
      db,
      rows.map((r) => r.stringId),
      targetLang,
      srcLang,
    );
  };

  const chunkCtx = createChunkTranslateContext(
    db,
    opts,
    rag,
    ragMaxExamples,
    ragMinSimilarity,
    glossaryAll,
    emitResult,
    persistPool,
    persistJobs,
    persistAutoTranslationRows,
  );

  const { llmPending, immediateResults } = prepareLlmItems(
    eligibleIds,
    rowById,
    { modGame, modName, shouldCancel },
    emitResult,
  );

  const llmChunks = buildLlmTranslateChunks(llmPending, {
    batchSize: CONFIG.batchSize,
    maxSourceChars: CONFIG.llmBatchMaxSourceChars,
    singleRowMaxSourceChars: CONFIG.llmBatchMaxSingleSourceChars,
  });

  if (immediateResults.length > 0) {
    await persistAutoTranslationRows(immediateResults);
    for (const r of immediateResults) emitResult(r);
  }

  if (llmChunks.length > 0 && !shouldCancel?.()) {
    const chatConcurrency = llmChatPipelineConcurrency();
    logTranslate.info('LLM pipelined chat phase', {
      chunkCount: llmChunks.length,
      pendingItems: llmPending.length,
      chatConcurrency,
      llmMaxParallel: CONFIG.llmMaxParallel,
      embedMaxParallel: CONFIG.embedMaxParallel,
    });

    await runLlmChunkWorkPool({
      initialChunks: llmChunks,
      concurrency: chatConcurrency,
      shouldAbort: shouldCancel,
      runOnce: async (chunk, { enqueueSplit }) => {
        const ragByStringId = await prefetchChunkRag(chunkCtx, [...chunk]);
        if (chunk.length === 1) {
          logTranslate.debug('solo LLM translate request', { stringId: chunk[0]!.stringId });
        }
        await translateChunkOnce(chunkCtx, [...chunk], ragByStringId, (parts) =>
          enqueueSplit(parts),
        );
      },
      shouldSplit: chunkWorkPoolShouldSplit,
      onFailure: (failed, message) => {
        for (const entry of failed) {
          emitResult({ stringId: entry.stringId, error: message });
        }
      },
      log: logTranslate,
      operation: 'translate',
      itemIds: (c) => c.map((e) => e.stringId),
    });

    await drainPersistJobs(persistJobs);
  }

  const ok = results.filter((r) => r.text).length;
  const failed = results.filter((r) => r.error).length;
  logTranslate.info('batch done', { total: eligibleIds.length, ok, failed });

  return results;
};

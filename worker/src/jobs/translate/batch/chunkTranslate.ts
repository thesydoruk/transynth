import type { Tx } from '../../../../../src/db';
import { CONFIG, getTranslateModel } from '../../../../../src/config';
import {
  translateStrings,
  isLlmResponseTruncatedError,
  isLlmTranslateMissingIdsError,
} from '../../../../../src/llm/translate';
import { isLlmTimeoutError } from '../../../../../src/llm/retry';
import { enqueueSoloChunks } from '../../../../../src/llm/chunkRecovery';
import { fetchReferenceExamplesBatch, type RagRetrievalOptions } from '../../../../../src/llm/rag';
import { logTranslate } from '../../../../../src/logging/loggers';
import { Semaphore } from '../../../../../src/utils/concurrency';
import { unmask, validateTranslationPlaceholders } from '../../../../../src/utils/placeholders';
import { maskLlmOptionalText, maskLlmReferenceExamples } from '../../../../../src/llm/llmTextMask';
import { normalizeAutoTranslation } from '../../../../../src/utils/textNorm';
import type { GameType } from '../../../../../src/types';
import { relevantGlossaryForChunk } from './glossary';
import {
  needsLongTextSplit,
  translateLongTextAfterTruncation,
  translateLongTextItem,
  finalizeLongTextTranslation,
} from './translateLongText';
import type {
  ChunkTranslateContext,
  GlossaryEntryWithRe,
  PreparedLlmItem,
  TranslateBatchOptions,
  TranslateBatchResult,
} from './types';

type RagByStringId = Awaited<ReturnType<typeof fetchReferenceExamplesBatch>>;

const toRagBatchItems = (entries: PreparedLlmItem[]) =>
  entries.map((entry) => ({
    stringId: entry.stringId,
    sourceText: entry.sourceText,
    textNorm: entry.textNorm,
    textNormNopunct: entry.textNormNopunct,
    signature: entry.grup,
    path: entry.recordPath,
    context: entry.llmItem.context,
  }));

export const prefetchChunkRag = async (
  ctx: ChunkTranslateContext,
  entries: PreparedLlmItem[],
): Promise<RagByStringId> => {
  if (entries.length === 0 || ctx.opts.shouldCancel?.() || ctx.rag.disableRag) return new Map();
  const started = Date.now();
  try {
    const ragByStringId = await fetchReferenceExamplesBatch(
      ctx.db,
      toRagBatchItems(entries),
      ctx.opts.srcLang,
      ctx.opts.targetLang,
      ctx.ragMaxExamples,
      ctx.ragMinSimilarity,
      ctx.rag,
    );
    logTranslate.debug('chunk RAG ready', {
      itemCount: entries.length,
      withExamples: [...ragByStringId.values()].filter((rows) => rows.length > 0).length,
      durationMs: Date.now() - started,
    });
    return ragByStringId;
  } catch (err) {
    logTranslate.warn('chunk RAG failed; translating without examples', {
      err: err instanceof Error ? err.message : String(err),
      itemCount: entries.length,
    });
    return new Map();
  }
};

export const scheduleChunkPersist = (
  ctx: ChunkTranslateContext,
  okRows: Array<{ stringId: number; text: string }>,
): void => {
  if (okRows.length === 0) return;
  ctx.persistJobs.push(
    ctx.persistPool.run(async () => {
      try {
        await ctx.persistAutoTranslationRows(okRows);
        for (const row of okRows) {
          ctx.emitResult({ stringId: row.stringId, text: row.text });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logTranslate.error('persist translation chunk failed', {
          err: message,
          rowCount: okRows.length,
        });
        for (const row of okRows) {
          ctx.emitResult({ stringId: row.stringId, error: `persist failed: ${message}` });
        }
      }
    }),
  );
};

export const collectValidatedRows = (
  ctx: ChunkTranslateContext,
  chunk: PreparedLlmItem[],
  translations: Awaited<ReturnType<typeof translateStrings>>,
): Array<{ stringId: number; text: string }> => {
  const translationById = new Map(translations.map((row) => [row.id, row.translation]));
  const okRows: Array<{ stringId: number; text: string }> = [];

  for (const entry of chunk) {
    const maskedTranslation = translationById.get(entry.stringId);
    if (maskedTranslation === undefined) {
      ctx.emitResult({
        stringId: entry.stringId,
        error: `LLM response missing translation for id=${entry.stringId}`,
      });
      continue;
    }

    const placeholderCheck = validateTranslationPlaceholders(
      entry.sourceText,
      maskedTranslation,
      entry.placeholderMap,
      entry.functionKeywordMap,
      (entry.game ?? ctx.opts.modGame) as GameType | undefined,
      { grup: entry.grup, field: entry.field },
    );
    if (!placeholderCheck.ok) {
      ctx.emitResult({
        stringId: entry.stringId,
        error: placeholderCheck.message,
      });
      continue;
    }

    const translated = normalizeAutoTranslation(
      entry.sourceText,
      unmask(unmask(maskedTranslation, entry.functionKeywordMap), entry.placeholderMap),
    );
    okRows.push({ stringId: entry.stringId, text: translated });
  }

  return okRows;
};

const translateLongEntries = async (
  ctx: ChunkTranslateContext,
  entries: PreparedLlmItem[],
  ragByStringId: RagByStringId,
): Promise<Array<{ stringId: number; text: string }>> => {
  const okRows: Array<{ stringId: number; text: string }> = [];

  for (const entry of entries) {
    const ragExamples = ragByStringId.get(entry.stringId);
    try {
      const translated = await translateLongTextItem(ctx, entry, ragExamples);
      const result = finalizeLongTextTranslation(ctx, entry, translated);
      if ('error' in result) {
        ctx.emitResult(result);
        continue;
      }
      okRows.push(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.emitResult({ stringId: entry.stringId, error: message });
    }
  }

  return okRows;
};

export const translateChunkOnce = async (
  ctx: ChunkTranslateContext,
  chunk: PreparedLlmItem[],
  ragByStringId: RagByStringId,
  enqueueSplit: (parts: readonly (readonly PreparedLlmItem[])[]) => void,
): Promise<void> => {
  const longEntries = chunk.filter(
    (entry) => needsLongTextSplit(entry.sourceText) || needsLongTextSplit(entry.llmItem.source),
  );
  const normalEntries = chunk.filter(
    (entry) => !needsLongTextSplit(entry.sourceText) && !needsLongTextSplit(entry.llmItem.source),
  );

  if (longEntries.length > 0) {
    scheduleChunkPersist(ctx, await translateLongEntries(ctx, longEntries, ragByStringId));
  }
  if (normalEntries.length === 0) return;

  try {
    const translations = await translateStrings({
      items: normalEntries.map((entry) => ({
        ...entry.llmItem,
        context: maskLlmOptionalText(entry.llmItem.context),
        reference_examples: maskLlmReferenceExamples(ragByStringId.get(entry.stringId)),
      })),
      model: ctx.model,
      srcLang: ctx.opts.srcLang,
      targetLang: ctx.opts.targetLang,
      game: ctx.opts.modGame ?? normalEntries[0]?.game,
      modName: ctx.opts.modName ?? normalEntries[0]?.modName,
      glossary: relevantGlossaryForChunk(
        ctx.glossaryAll,
        normalEntries.map((entry) => entry.sourceText),
      ),
      signal: ctx.opts.signal,
    });
    scheduleChunkPersist(ctx, collectValidatedRows(ctx, normalEntries, translations));
  } catch (err) {
    if (isLlmResponseTruncatedError(err) && normalEntries.length === 1) {
      const entry = normalEntries[0]!;
      const merged = await translateLongTextAfterTruncation(
        ctx,
        entry,
        ragByStringId.get(entry.stringId),
      );
      if (merged != null) {
        const result = finalizeLongTextTranslation(ctx, entry, merged);
        if ('error' in result) {
          ctx.emitResult(result);
        } else {
          scheduleChunkPersist(ctx, [result]);
        }
        return;
      }
    }
    if (isLlmTranslateMissingIdsError(err)) {
      const missingSet = new Set(err.missingIds);
      const okEntries = normalEntries.filter((entry) => !missingSet.has(entry.stringId));
      if (err.partialResults.length > 0) {
        scheduleChunkPersist(ctx, collectValidatedRows(ctx, okEntries, [...err.partialResults]));
      }
      const missingEntries = normalEntries.filter((entry) => missingSet.has(entry.stringId));
      if (normalEntries.length > 1) {
        logTranslate.warn('partial LLM batch — solo retry for missing rows', {
          ok: okEntries.length,
          missing: missingEntries.map((entry) => entry.stringId),
        });
        enqueueSoloChunks(missingEntries, enqueueSplit);
        return;
      }
      throw err;
    }
    if (isLlmTimeoutError(err) && normalEntries.length > 1) {
      logTranslate.warn('LLM translate batch timeout — solo retry', {
        chunkSize: normalEntries.length,
        itemIds: normalEntries.map((entry) => entry.stringId),
      });
      enqueueSoloChunks(normalEntries, enqueueSplit);
      return;
    }
    throw err;
  }
};

export const createChunkTranslateContext = (
  db: Tx,
  opts: TranslateBatchOptions,
  rag: RagRetrievalOptions,
  ragMaxExamples: number,
  ragMinSimilarity: number,
  glossaryAll: GlossaryEntryWithRe[],
  emitResult: (r: TranslateBatchResult) => void,
  persistPool: Semaphore,
  persistJobs: Promise<void>[],
  persistAutoTranslationRows: (rows: Array<{ stringId: number; text: string }>) => Promise<void>,
): ChunkTranslateContext => ({
  db,
  opts,
  rag,
  ragMaxExamples,
  ragMinSimilarity,
  glossaryAll,
  model: getTranslateModel(),
  emitResult,
  persistPool,
  persistJobs,
  persistAutoTranslationRows,
});

export const chunkWorkPoolShouldSplit = (err: unknown): boolean =>
  isLlmResponseTruncatedError(err) || isLlmTranslateMissingIdsError(err) || isLlmTimeoutError(err);

export const createPersistPool = (): { pool: Semaphore; jobs: Promise<void>[] } => {
  const persistConcurrency = Math.max(2, Math.min(8, CONFIG.dbPoolMax));
  return { pool: new Semaphore(persistConcurrency), jobs: [] };
};

export const drainPersistJobs = async (persistJobs: Promise<void>[]): Promise<void> => {
  if (persistJobs.length === 0) return;
  logTranslate.debug('draining async persist queue', { jobs: persistJobs.length });
  await Promise.all(persistJobs);
};

import type { Tx } from '../../../db';
import { CONFIG, getTranslateModel } from '../../../config';
import {
  translateStrings,
  isLlmResponseTruncatedError,
  isLlmTranslateMissingIdsError,
} from '../../../llm/translate';
import { isLlmTimeoutError } from '../../../llm/retry';
import { enqueueSoloChunks } from '../../../llm/chunkRecovery';
import { fetchReferenceExamplesBatch, type RagRetrievalOptions } from '../../../llm/rag';
import { logTranslate } from '../../../logging/loggers';
import { Semaphore } from '../../../utils/concurrency';
import { unmask, validateTranslationPlaceholders } from '../../../utils/placeholders';
import { maskLlmOptionalText, maskLlmReferenceExamples } from '../../../llm/llmTextMask';
import { normalizeAutoTranslationDashes } from '../../../utils/textNorm';
import type { GameType } from '../../../types';
import { relevantGlossaryForChunk } from './glossary';
import type {
  GlossaryEntryWithRe,
  PreparedLlmItem,
  TranslateBatchOptions,
  TranslateBatchResult,
} from './types';

type RagByStringId = Awaited<ReturnType<typeof fetchReferenceExamplesBatch>>;

export type ChunkTranslateContext = {
  db: Tx;
  opts: Pick<
    TranslateBatchOptions,
    'srcLang' | 'targetLang' | 'modGame' | 'modName' | 'signal' | 'shouldCancel'
  >;
  rag: RagRetrievalOptions;
  ragMaxExamples: number;
  ragMinSimilarity: number;
  glossaryAll: GlossaryEntryWithRe[];
  model: string;
  emitResult: (r: TranslateBatchResult) => void;
  persistPool: Semaphore;
  persistJobs: Promise<void>[];
  persistAutoTranslationRows: (rows: Array<{ stringId: number; text: string }>) => Promise<void>;
};

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

    const translated = normalizeAutoTranslationDashes(
      unmask(unmask(maskedTranslation, entry.functionKeywordMap), entry.placeholderMap),
    );
    okRows.push({ stringId: entry.stringId, text: translated });
  }

  return okRows;
};

export const translateChunkOnce = async (
  ctx: ChunkTranslateContext,
  chunk: PreparedLlmItem[],
  ragByStringId: RagByStringId,
  enqueueSplit: (parts: readonly (readonly PreparedLlmItem[])[]) => void,
): Promise<void> => {
  try {
    const translations = await translateStrings({
      items: chunk.map((entry) => ({
        ...entry.llmItem,
        context: maskLlmOptionalText(entry.llmItem.context),
        reference_examples: maskLlmReferenceExamples(ragByStringId.get(entry.stringId)),
      })),
      model: ctx.model,
      srcLang: ctx.opts.srcLang,
      targetLang: ctx.opts.targetLang,
      game: ctx.opts.modGame ?? chunk[0]?.game,
      modName: ctx.opts.modName ?? chunk[0]?.modName,
      glossary: relevantGlossaryForChunk(
        ctx.glossaryAll,
        chunk.map((entry) => entry.sourceText),
      ),
      signal: ctx.opts.signal,
    });
    scheduleChunkPersist(ctx, collectValidatedRows(ctx, chunk, translations));
  } catch (err) {
    if (isLlmTranslateMissingIdsError(err)) {
      const missingSet = new Set(err.missingIds);
      const okEntries = chunk.filter((entry) => !missingSet.has(entry.stringId));
      if (err.partialResults.length > 0) {
        scheduleChunkPersist(ctx, collectValidatedRows(ctx, okEntries, [...err.partialResults]));
      }
      const missingEntries = chunk.filter((entry) => missingSet.has(entry.stringId));
      if (chunk.length > 1) {
        logTranslate.warn('partial LLM batch — solo retry for missing rows', {
          ok: okEntries.length,
          missing: missingEntries.map((entry) => entry.stringId),
        });
        enqueueSoloChunks(missingEntries, enqueueSplit);
        return;
      }
      throw err;
    }
    if (isLlmTimeoutError(err) && chunk.length > 1) {
      logTranslate.warn('LLM translate batch timeout — solo retry', {
        chunkSize: chunk.length,
        itemIds: chunk.map((entry) => entry.stringId),
      });
      enqueueSoloChunks(chunk, enqueueSplit);
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

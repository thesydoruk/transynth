/**
 * Shared batch LLM translation for a list of string IDs.
 */
import type { Tx } from '../db';
import { CONFIG, getTranslateModel } from '../config';
import {
  translateStrings,
  isLlmResponseTruncatedError,
  type LlmGlossaryEntry,
  type LlmTranslateItem,
} from '../llm/translate';
import { isAbortError, isLlmTimeoutError } from '../llm/retry';
import { clampRagMaxExamples } from '../llm/ragConstants';
import { fetchReferenceExamplesBatch, requirePgvectorForRag } from '../llm/ragService';
import { getAllProjectSettings } from './projectSettings';
import { cacheLookupMany, cacheStore } from './cacheService';
import { upsertTranslation, termWordBoundaryRe, filterStringIdsForLlmTranslate } from './queries';
import { logTranslate } from '../logging/loggers';
import { maskFunctionKeywords, maskPlaceholders, unmask } from '../utils/placeholders';
import { parseRecordLocation } from '../utils/recordLocation';
import { mapWithConcurrency } from '../utils/concurrency';
import type { GameType } from '../types';
import { buildLlmTranslateChunks } from './llmTranslateChunking';

export type TranslateBatchResult = { stringId: number; text?: string; error?: string };

export type TranslateBatchOptions = {
  srcLang: string;
  targetLang: string;
  modGame?: string | null;
  modName?: string | null;
  shouldCancel?: () => boolean;
  /** Aborts in-flight LLM requests when the owning job is stopped. */
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, result: TranslateBatchResult) => void;
};

type StringRow = {
  id: number;
  text_raw: string;
  text_norm: string | null;
  text_norm_nopunct: string | null;
  context: string | null;
  signature: string | null;
  path: string | null;
  edid: string | null;
  formid_hex: string | null;
  game: string;
  mod_name: string;
};

type PreparedLlmItem = {
  stringId: number;
  sourceText: string;
  textNorm: string | null;
  textNormNopunct: string | null;
  grup: string | null;
  recordPath: string | null;
  placeholderMap: Record<string, string>;
  functionKeywordMap: Record<string, string>;
  game: string | null;
  modName: string | null;
  llmItem: LlmTranslateItem;
};

/** Translate a batch of source string IDs via LLM (RAG, cache, glossary). */
export const translateStringIdsBatch = async (
  db: Tx,
  stringIds: number[],
  opts: TranslateBatchOptions,
): Promise<TranslateBatchResult[]> => {
  if (stringIds.length === 0) return [];

  const { srcLang, targetLang, modGame, modName, shouldCancel, signal, onProgress } = opts;
  const eligibleIds = await filterStringIdsForLlmTranslate(db, stringIds, targetLang);
  if (eligibleIds.length === 0) return [];

  logTranslate.info('batch start', {
    stringCount: eligibleIds.length,
    skippedProtected: stringIds.length - eligibleIds.length,
    srcLang,
    targetLang,
    modGame: modGame ?? null,
    modName: modName ?? null,
  });

  await requirePgvectorForRag(db);

  const model = getTranslateModel();

  // Load the full glossary once. Rather than blindly sending the first 80 terms
  // (alphabetically) with every batch — which both wastes context and silently
  // drops relevant terms past the cutoff — we keep all entries here and filter
  // them per chunk to only those whose English term actually appears in that
  // chunk's source strings (see relevantGlossary below).
  const { rows: glossaryRows } = await db.query<{ term: string; translation: string | null }>(
    `SELECT term, translation FROM glossary WHERE src_lang = $1 AND tgt_lang = $2 ORDER BY term LIMIT 2000`,
    [srcLang, targetLang],
  );
  const glossaryAll: Array<LlmGlossaryEntry & { re: RegExp }> = glossaryRows
    .filter((g) => g.term.trim() !== '')
    .map((g) => ({ ...g, re: termWordBoundaryRe(g.term) }));

  /**
   * Pick the glossary entries relevant to a chunk: a term is included only when
   * it appears (on word boundaries) in at least one of the chunk's source texts.
   * Capped at 100 entries to bound the prompt size for very large batches.
   */
  const relevantGlossary = (sourceTexts: string[]): LlmGlossaryEntry[] => {
    if (glossaryAll.length === 0) return [];
    const out: LlmGlossaryEntry[] = [];
    for (const g of glossaryAll) {
      if (sourceTexts.some((text) => g.re.test(text))) {
        out.push({ term: g.term, translation: g.translation });
        if (out.length >= 100) break;
      }
    }
    return out;
  };
  const projectSettings = await getAllProjectSettings(db);
  const ragMaxExamples = clampRagMaxExamples(projectSettings['llm.rag_max_examples']);
  const ragMinSimilarity = Math.min(1, Math.max(0, projectSettings['llm.rag_min_similarity']));

  const { rows: loadedRows } = await db.query<StringRow>(
    `SELECT s.id, s.text_raw, s.text_norm, s.text_norm_nopunct, s.context,
            r.signature, r.path, r.edid, r.formid_hex, m.game, m.name AS mod_name
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN mods m ON m.id = r.mod_id
      WHERE s.id = ANY($1::int[]) AND s.lang = $2`,
    [eligibleIds, srcLang],
  );
  const rowById = new Map(loadedRows.map((row) => [row.id, row]));

  const results: TranslateBatchResult[] = [];
  let doneCount = 0;

  /** Single source of truth for emitting a per-string result + live progress. */
  const emitResult = (r: TranslateBatchResult) => {
    results.push(r);
    doneCount++;
    onProgress?.(doneCount, eligibleIds.length, r);
  };

  // Concurrency model: RAG (embedding + TM DB lookups) and chat run in two distinct
  // phases. If RAG were interleaved per-chunk before each chat, simultaneous RAG would
  // saturate the DB pool / embed semaphore and chat requests would trickle out roughly
  // one at a time. Gathering all RAG first, then firing chats together, keeps up to
  // CONFIG.llmMaxParallel chat requests genuinely in flight at once.
  const ragConcurrency = CONFIG.llmMaxParallel;
  // Chat is globally capped by the llm semaphore; +1 worker covers the brief post-chat
  // DB-write window so a chat slot doesn't idle while a worker persists results.
  const chatConcurrency = CONFIG.llmMaxParallel + 1;
  // Bound post-chat DB writes per chunk so a single batch can't monopolise the pool.
  const dbWriteConcurrency = Math.max(2, Math.min(8, CONFIG.dbPoolMax));

  // Batch the cache warm-up: one query instead of one round trip per string.
  const cacheCandidates = eligibleIds
    .map((id) => rowById.get(id)?.text_raw)
    .filter((text): text is string => typeof text === 'string');
  let cacheByRaw: Map<string, string>;
  try {
    cacheByRaw = await cacheLookupMany(db, cacheCandidates, srcLang, targetLang, model);
  } catch (err) {
    logTranslate.error('batch cache lookup failed', { err });
    cacheByRaw = new Map();
  }

  const llmPending: PreparedLlmItem[] = [];

  /** Strings resolved without the LLM (untranslatable or cache hit) — persisted in bulk. */
  const immediateResults: Array<{ stringId: number; text: string }> = [];

  type RagByStringId = Awaited<ReturnType<typeof fetchReferenceExamplesBatch>>;

  /** Phase 1 — gather RAG few-shot context for one chunk. Degrades to no examples on error. */
  const fetchChunkRag = async (chunk: PreparedLlmItem[]): Promise<RagByStringId> => {
    if (chunk.length === 0 || shouldCancel?.()) return new Map();
    try {
      return await fetchReferenceExamplesBatch(
        db,
        chunk.map((entry) => ({
          stringId: entry.stringId,
          sourceText: entry.sourceText,
          textNorm: entry.textNorm,
          textNormNopunct: entry.textNormNopunct,
          signature: entry.grup,
          path: entry.recordPath,
          context: entry.llmItem.context,
        })),
        srcLang,
        targetLang,
        ragMaxExamples,
        ragMinSimilarity,
      );
    } catch (err) {
      logTranslate.warn('RAG fetch failed for chunk; translating without examples', {
        err: err instanceof Error ? err.message : String(err),
        stringIds: chunk.map((e) => e.stringId),
      });
      return new Map();
    }
  };

  /** Phase 2 — translate one chunk (single LLM chat) and persist the results. */
  const persistChunkResults = async (
    chunk: PreparedLlmItem[],
    ragByStringId: RagByStringId,
    translations: Awaited<ReturnType<typeof translateStrings>>,
  ): Promise<void> => {
    const translationById = new Map(translations.map((row) => [row.id, row.translation]));

    await mapWithConcurrency(chunk, dbWriteConcurrency, async (entry) => {
      const maskedTranslation = translationById.get(entry.stringId);
      if (maskedTranslation === undefined) {
        emitResult({
          stringId: entry.stringId,
          error: `LLM response missing translation for id=${entry.stringId}`,
        });
        return;
      }

      const translated = unmask(
        unmask(maskedTranslation, entry.functionKeywordMap),
        entry.placeholderMap,
      );
      await cacheStore(db, entry.sourceText, srcLang, targetLang, model, translated);
      await upsertTranslation(db, entry.stringId, translated, 'auto', targetLang);
      emitResult({ stringId: entry.stringId, text: translated });
    });
  };

  const translateChunkOnce = async (
    chunk: PreparedLlmItem[],
    ragByStringId: RagByStringId,
  ): Promise<void> => {
    const translations = await translateStrings({
      items: chunk.map((entry) => ({
        ...entry.llmItem,
        reference_examples: ragByStringId.get(entry.stringId),
      })),
      model,
      srcLang,
      targetLang,
      game: modGame ?? chunk[0]?.game,
      modName: modName ?? chunk[0]?.modName,
      glossary: relevantGlossary(chunk.map((entry) => entry.sourceText)),
      signal,
    });
    await persistChunkResults(chunk, ragByStringId, translations);
  };

  const chunkBackoffMs = (attempt: number): number =>
    Math.min(1000 * Math.pow(2, attempt) + Math.random() * 300, 30_000);

  const splitChunkToRows = async (
    chunk: PreparedLlmItem[],
    ragByStringId: RagByStringId,
    reason: string,
  ): Promise<void> => {
    logTranslate.warn('LLM chunk split to single rows', {
      reason,
      chunkSize: chunk.length,
      stringIds: chunk.map((e) => e.stringId),
    });
    for (const entry of chunk) {
      if (shouldCancel?.()) return;
      await runChunkWithRetry([entry], ragByStringId);
    }
  };

  const splitChunk = async (
    chunk: PreparedLlmItem[],
    ragByStringId: RagByStringId,
    reason: string,
  ): Promise<void> => {
    const mid = Math.ceil(chunk.length / 2);
    logTranslate.warn('LLM chunk split', {
      reason,
      chunkSize: chunk.length,
      firstHalf: chunk.slice(0, mid).map((e) => e.stringId),
      secondHalf: chunk.slice(mid).map((e) => e.stringId),
    });
    await runChunkWithRetry(chunk.slice(0, mid), ragByStringId);
    await runChunkWithRetry(chunk.slice(mid), ragByStringId);
  };

  const runChunkWithRetry = async (
    chunk: PreparedLlmItem[],
    ragByStringId: RagByStringId,
  ): Promise<void> => {
    if (chunk.length === 0 || shouldCancel?.()) return;

    logTranslate.debug('LLM chunk flush', {
      chunkSize: chunk.length,
      sourceChars: chunk.reduce((sum, e) => sum + e.sourceText.length, 0),
      stringIds: chunk.map((e) => e.stringId),
    });

    const maxAttempts = CONFIG.llmMaxAttempts;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await translateChunkOnce(chunk, ragByStringId);
        return;
      } catch (err) {
        if (shouldCancel?.() || isAbortError(err)) return;

        const message = err instanceof Error ? err.message : String(err);

        if (isLlmTimeoutError(err) && chunk.length > 1) {
          await splitChunkToRows(chunk, ragByStringId, message);
          return;
        }

        if (isLlmResponseTruncatedError(err) && chunk.length > 1) {
          await splitChunk(chunk, ragByStringId, err.message);
          return;
        }

        if (attempt < maxAttempts - 1) {
          logTranslate.warn('LLM chunk retry', {
            attempt: attempt + 1,
            maxAttempts,
            error: message,
            chunkSize: chunk.length,
            stringIds: chunk.map((e) => e.stringId),
          });
          await new Promise((r) => setTimeout(r, chunkBackoffMs(attempt)));
          continue;
        }

        if (chunk.length > 1) {
          await splitChunk(chunk, ragByStringId, message);
          return;
        }

        logTranslate.error('LLM translate failed for batch', {
          error: message,
          stack: err instanceof Error ? err.stack : undefined,
          stringIds: chunk.map((e) => e.stringId),
        });
        emitResult({ stringId: chunk[0]!.stringId, error: message });
      }
    }
  };

  for (const stringId of eligibleIds) {
    if (shouldCancel?.()) break;

    const row = rowById.get(stringId);
    if (!row) {
      emitResult({ stringId, error: 'not found' });
      continue;
    }

    const sourceText = row.text_raw;
    const game = row.game ?? modGame ?? undefined;
    const { masked: placeholderMasked, mapping: placeholderMap } = maskPlaceholders(sourceText);
    const { masked: protectedMasked, mapping: functionKeywordMap } = maskFunctionKeywords(
      placeholderMasked,
      game as GameType | undefined,
    );
    const maskedSourceText = protectedMasked;

    const translatableContent = maskedSourceText.replace(/¤(?:PH|GL|FK)\d+¤/g, '').trim();
    if (!translatableContent) {
      immediateResults.push({ stringId, text: sourceText });
      continue;
    }

    const cached = cacheByRaw.get(sourceText);
    if (cached !== undefined) {
      logTranslate.debug('cache hit', { stringId, srcLang, targetLang, model });
      immediateResults.push({ stringId, text: cached });
      continue;
    }
    logTranslate.trace('cache miss', { stringId, srcLang, targetLang, model });

    llmPending.push({
      stringId,
      sourceText,
      textNorm: row.text_norm,
      textNormNopunct: row.text_norm_nopunct,
      grup: parseRecordLocation(row.signature, row.path).grup,
      recordPath: row.path,
      placeholderMap,
      functionKeywordMap,
      game: row.game ?? modGame,
      modName: row.mod_name ?? modName,
      llmItem: (() => {
        const { grup, field } = parseRecordLocation(row.signature, row.path);
        return {
          id: stringId,
          source: maskedSourceText,
          grup,
          edid: row.edid,
          field,
          form_id: row.formid_hex,
          context: row.context,
        };
      })(),
    });
  }

  const llmChunks = buildLlmTranslateChunks(llmPending, {
    batchSize: CONFIG.batchSize,
    maxSourceChars: CONFIG.llmBatchMaxSourceChars,
    singleRowMaxSourceChars: CONFIG.llmBatchMaxSingleSourceChars,
  });

  // Persist cache hits / untranslatable strings concurrently before/while the LLM runs.
  if (immediateResults.length > 0) {
    await mapWithConcurrency(immediateResults, dbWriteConcurrency, async (r) => {
      await upsertTranslation(db, r.stringId, r.text, 'auto', targetLang);
    });
    for (const r of immediateResults) emitResult(r);
  }

  if (llmChunks.length > 0 && !shouldCancel?.()) {
    // Phase 1: gather RAG context for every chunk (embeds are globally semaphore-gated).
    const ragByChunk = await mapWithConcurrency(llmChunks, ragConcurrency, (chunk) =>
      fetchChunkRag(chunk),
    );

    if (!shouldCancel?.()) {
      // Phase 2: fire the chat requests in parallel — up to CONFIG.llmMaxParallel run
      // concurrently (enforced by the chat semaphore inside chatWithFallback).
      logTranslate.info('LLM parallel chat phase', {
        chunkCount: llmChunks.length,
        chatConcurrency,
        llmMaxParallel: CONFIG.llmMaxParallel,
      });

      await mapWithConcurrency(llmChunks, chatConcurrency, (chunk, index) =>
        runChunkWithRetry(chunk, ragByChunk[index]!),
      );
    }
  }

  const ok = results.filter((r) => r.text).length;
  const failed = results.filter((r) => r.error).length;
  logTranslate.info('batch done', { total: eligibleIds.length, ok, failed });

  return results;
};

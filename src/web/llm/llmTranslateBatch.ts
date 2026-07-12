/**
 * Shared batch LLM translation for a list of string IDs.
 */
import type { Tx } from '../../db';
import { CONFIG, getTranslateModel } from '../../config';
import {
  translateStrings,
  isLlmResponseTruncatedError,
  isLlmTranslateMissingIdsError,
  type LlmGlossaryEntry,
  type LlmTranslateItem,
} from '../../llm/translate';
import { isLlmTimeoutError } from '../../llm/retry';
import { runLlmChunkWorkPool, enqueueSoloChunks } from '../../llm/chunkRecovery';
import { llmChatPipelineConcurrency } from '../../llm/requestPool';
import {
  fetchReferenceExamplesBatch,
  requirePgvectorForRag,
  type RagRetrievalOptions,
} from '../../llm/ragService';
import { getAllProjectSettings } from '../services/projectSettings';
import { bulkUpsertAutoTranslations } from '../import/modImportBulk';
import {
  termWordBoundaryRe,
  filterStringIdsForLlmTranslate,
  type LlmTranslateOverwriteMode,
} from '../data/queries';
import { scheduleRefreshQAIssuesBatch } from '../services/qaHooks';
import { logTranslate } from '../../logging/loggers';
import { Semaphore } from '../../utils/concurrency';
import {
  maskFunctionKeywords,
  maskPlaceholders,
  unmask,
  validateTranslationPlaceholders,
} from '../../utils/placeholders';
import { maskLlmOptionalText, maskLlmReferenceExamples } from '../../llm/llmTextMask';
import { normalizeAutoTranslationDashes } from '../../utils/textNorm';
import { parseRecordLocation } from '../../utils/recordLocation';
import { clampRagMaxExamples } from '../../llm/ragConstants';
import { buildLlmTranslateChunks } from './llmTranslateChunking';
import type { GameType } from '../../types';

export type TranslateBatchResult = {
  stringId: number;
  text?: string;
  error?: string;
};

export type TranslateBatchOptions = {
  srcLang: string;
  targetLang: string;
  modGame?: string | null;
  modName?: string | null;
  overwriteMode?: LlmTranslateOverwriteMode;
  rag?: RagRetrievalOptions;
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
  field: string | null;
  recordPath: string | null;
  placeholderMap: Record<string, string>;
  functionKeywordMap: Record<string, string>;
  game: string | null;
  modName: string | null;
  llmItem: LlmTranslateItem;
};

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

  // Per-chunk RAG + work pool: LLM slots stay full; persist runs in the background.
  const chatConcurrency = llmChatPipelineConcurrency();
  const persistConcurrency = Math.max(2, Math.min(8, CONFIG.dbPoolMax));
  const persistPool = new Semaphore(persistConcurrency);
  const persistJobs: Promise<void>[] = [];

  /** Bulk persist auto translations, then refresh QA in the background. */
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

  const llmPending: PreparedLlmItem[] = [];

  /** Strings resolved without the LLM (placeholder-only) — persisted in bulk. */
  const immediateResults: Array<{ stringId: number; text: string }> = [];

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

  /** RAG for one LLM chunk — runs inside the work pool so embed overlaps with chat. */
  const prefetchChunkRag = async (entries: PreparedLlmItem[]): Promise<RagByStringId> => {
    if (entries.length === 0 || shouldCancel?.() || rag.disableRag) return new Map();
    const started = Date.now();
    try {
      const ragByStringId = await fetchReferenceExamplesBatch(
        db,
        toRagBatchItems(entries),
        srcLang,
        targetLang,
        ragMaxExamples,
        ragMinSimilarity,
        rag,
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

  /** Queue DB persist — LLM workers return immediately after scheduling this. */
  const scheduleChunkPersist = (okRows: Array<{ stringId: number; text: string }>): void => {
    if (okRows.length === 0) return;
    persistJobs.push(
      persistPool.run(async () => {
        try {
          await persistAutoTranslationRows(okRows);
          for (const row of okRows) {
            emitResult({ stringId: row.stringId, text: row.text });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logTranslate.error('persist translation chunk failed', {
            err: message,
            rowCount: okRows.length,
          });
          for (const row of okRows) {
            emitResult({ stringId: row.stringId, error: `persist failed: ${message}` });
          }
        }
      }),
    );
  };

  const collectValidatedRows = (
    chunk: PreparedLlmItem[],
    translations: Awaited<ReturnType<typeof translateStrings>>,
  ): Array<{ stringId: number; text: string }> => {
    const translationById = new Map(translations.map((row) => [row.id, row.translation]));
    const okRows: Array<{ stringId: number; text: string }> = [];

    for (const entry of chunk) {
      const maskedTranslation = translationById.get(entry.stringId);
      if (maskedTranslation === undefined) {
        emitResult({
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
        (entry.game ?? modGame) as GameType | undefined,
        { grup: entry.grup, field: entry.field },
      );
      if (!placeholderCheck.ok) {
        emitResult({
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

  const translateChunkOnce = async (
    chunk: PreparedLlmItem[],
    ragByStringId: RagByStringId,
    enqueueSplit: (parts: PreparedLlmItem[][]) => void,
  ): Promise<void> => {
    try {
      const translations = await translateStrings({
        items: chunk.map((entry) => ({
          ...entry.llmItem,
          context: maskLlmOptionalText(entry.llmItem.context),
          reference_examples: maskLlmReferenceExamples(ragByStringId.get(entry.stringId)),
        })),
        model,
        srcLang,
        targetLang,
        game: modGame ?? chunk[0]?.game,
        modName: modName ?? chunk[0]?.modName,
        glossary: relevantGlossary(chunk.map((entry) => entry.sourceText)),
        signal,
      });
      scheduleChunkPersist(collectValidatedRows(chunk, translations));
    } catch (err) {
      if (isLlmTranslateMissingIdsError(err)) {
        const missingSet = new Set(err.missingIds);
        const okEntries = chunk.filter((entry) => !missingSet.has(entry.stringId));
        if (err.partialResults.length > 0) {
          scheduleChunkPersist(collectValidatedRows(okEntries, [...err.partialResults]));
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

  for (const stringId of eligibleIds) {
    if (shouldCancel?.()) break;

    const row = rowById.get(stringId);
    if (!row) {
      emitResult({ stringId, error: 'not found' });
      continue;
    }

    const sourceText = row.text_raw;
    const game = row.game ?? modGame ?? undefined;
    const { grup, field } = parseRecordLocation(row.signature, row.path);

    const { masked: placeholderMasked, mapping: placeholderMap } = maskPlaceholders(sourceText);
    const { masked: protectedMasked, mapping: functionKeywordMap } = maskFunctionKeywords(
      placeholderMasked,
      game as GameType | undefined,
      { grup, field },
    );
    const maskedSourceText = protectedMasked;

    const translatableContent = maskedSourceText.replace(/¤(?:PH|GL|FK)\d+¤/g, '').trim();
    if (!translatableContent) {
      immediateResults.push({ stringId, text: sourceText });
      continue;
    }

    llmPending.push({
      stringId,
      sourceText,
      textNorm: row.text_norm,
      textNormNopunct: row.text_norm_nopunct,
      grup,
      field,
      recordPath: row.path,
      placeholderMap,
      functionKeywordMap,
      game: row.game ?? modGame,
      modName: row.mod_name ?? modName,
      llmItem: (() => {
        return {
          id: stringId,
          source: maskedSourceText,
          grup,
          edid: row.edid,
          field,
          form_id: row.formid_hex,
          context: maskLlmOptionalText(row.context),
        };
      })(),
    });
  }

  const llmChunks = buildLlmTranslateChunks(llmPending, {
    batchSize: CONFIG.batchSize,
    maxSourceChars: CONFIG.llmBatchMaxSourceChars,
    singleRowMaxSourceChars: CONFIG.llmBatchMaxSingleSourceChars,
  });

  // Persist placeholder-only strings before/while the LLM runs.
  if (immediateResults.length > 0) {
    await persistAutoTranslationRows(immediateResults);
    for (const r of immediateResults) emitResult(r);
  }

  if (llmChunks.length > 0 && !shouldCancel?.()) {
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
        const ragByStringId = await prefetchChunkRag([...chunk]);
        if (chunk.length === 1) {
          logTranslate.debug('solo LLM translate request', { stringId: chunk[0]!.stringId });
        }
        await translateChunkOnce([...chunk], ragByStringId, (parts) => enqueueSplit(parts));
      },
      shouldSplit: (err) =>
        isLlmResponseTruncatedError(err) ||
        isLlmTranslateMissingIdsError(err) ||
        isLlmTimeoutError(err),
      onFailure: (failed, message) => {
        for (const entry of failed) {
          emitResult({ stringId: entry.stringId, error: message });
        }
      },
      log: logTranslate,
      operation: 'translate',
      itemIds: (c) => c.map((e) => e.stringId),
    });

    if (persistJobs.length > 0) {
      logTranslate.debug('draining async persist queue', { jobs: persistJobs.length });
      await Promise.all(persistJobs);
    }
  }

  const ok = results.filter((r) => r.text).length;
  const failed = results.filter((r) => r.error).length;
  logTranslate.info('batch done', { total: eligibleIds.length, ok, failed });

  return results;
};

/**
 * Shared batch LLM translation for a list of string IDs.
 */
import type { Tx } from '../db';
import { CONFIG, getTranslateModel } from '../config';
import { translateStrings, type LlmGlossaryEntry, type LlmTranslateItem } from '../llm/translate';
import { clampRagMaxExamples } from '../llm/ragConstants';
import { fetchReferenceExamplesBatch, requirePgvectorForRag } from '../llm/ragService';
import { getAllProjectSettings } from './projectSettings';
import { cacheLookup, cacheStore } from './cacheService';
import { upsertTranslation } from './queries';
import { logTranslate } from '../logging/loggers';
import { maskFunctionKeywords, maskPlaceholders, unmask } from '../utils/placeholders';
import { parseRecordLocation } from '../utils/recordLocation';
import type { GameType } from '../types';

export type TranslateBatchResult = { stringId: number; text?: string; error?: string };

export type TranslateBatchOptions = {
  srcLang: string;
  targetLang: string;
  modGame?: string | null;
  modName?: string | null;
  shouldCancel?: () => boolean;
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

  const { srcLang, targetLang, modGame, modName, shouldCancel, onProgress } = opts;

  logTranslate.info('batch start', {
    stringCount: stringIds.length,
    srcLang,
    targetLang,
    modGame: modGame ?? null,
    modName: modName ?? null,
  });

  await requirePgvectorForRag(db);

  const model = getTranslateModel();

  const { rows: glossaryRows } = await db.query<{ term: string; translation: string | null }>(
    `SELECT term, translation FROM glossary WHERE src_lang = $1 AND tgt_lang = $2 ORDER BY term LIMIT 80`,
    [srcLang, targetLang],
  );
  const glossary: LlmGlossaryEntry[] = glossaryRows;
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
    [stringIds, srcLang],
  );
  const rowById = new Map(loadedRows.map((row) => [row.id, row]));

  const results: TranslateBatchResult[] = [];
  let doneCount = 0;
  const llmBuffer: PreparedLlmItem[] = [];

  const finishResult = async (stringId: number, text: string) => {
    await upsertTranslation(db, stringId, text, 'auto', targetLang);
    const r = { stringId, text };
    results.push(r);
    doneCount++;
    onProgress?.(doneCount, stringIds.length, r);
  };

  const failResult = (stringId: number, error: string) => {
    const r = { stringId, error };
    results.push(r);
    doneCount++;
    onProgress?.(doneCount, stringIds.length, r);
  };

  const flushLlmBuffer = async () => {
    if (llmBuffer.length === 0 || shouldCancel?.()) return;

    const chunk = llmBuffer.splice(0, llmBuffer.length);
    logTranslate.debug('LLM chunk flush', {
      chunkSize: chunk.length,
      stringIds: chunk.map((e) => e.stringId),
    });
    try {
      const ragByStringId = await fetchReferenceExamplesBatch(
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

      if (shouldCancel?.()) return;

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
        glossary,
      });

      const translationById = new Map(translations.map((row) => [row.id, row.translation]));

      for (const entry of chunk) {
        if (shouldCancel?.()) return;
        const maskedTranslation = translationById.get(entry.stringId);
        if (maskedTranslation === undefined) {
          failResult(entry.stringId, `LLM response missing translation for id=${entry.stringId}`);
          continue;
        }

        const translated = unmask(
          unmask(maskedTranslation, entry.functionKeywordMap),
          entry.placeholderMap,
        );
        await cacheStore(db, entry.sourceText, srcLang, targetLang, model, translated);
        await finishResult(entry.stringId, translated);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logTranslate.error('LLM translate failed for batch', {
        error: message,
        stack: err instanceof Error ? err.stack : undefined,
        stringIds: chunk.map((e) => e.stringId),
      });
      for (const entry of chunk) {
        failResult(entry.stringId, message);
      }
    }
  };

  for (const stringId of stringIds) {
    if (shouldCancel?.()) break;

    const row = rowById.get(stringId);
    if (!row) {
      failResult(stringId, 'not found');
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
      await finishResult(stringId, sourceText);
      continue;
    }

    try {
      const cached = await cacheLookup(db, sourceText, srcLang, targetLang, model);
      if (cached) {
        logTranslate.debug('cache hit', { stringId, srcLang, targetLang, model });
        await finishResult(stringId, cached.translated);
        continue;
      }
      logTranslate.trace('cache miss', { stringId, srcLang, targetLang, model });
    } catch (err) {
      logTranslate.error('cache lookup failed', { err, stringId });
      failResult(stringId, err instanceof Error ? err.message : String(err));
      continue;
    }

    llmBuffer.push({
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

    if (llmBuffer.length >= CONFIG.batchSize) {
      await flushLlmBuffer();
    }
  }

  await flushLlmBuffer();

  const ok = results.filter((r) => r.text).length;
  const failed = results.filter((r) => r.error).length;
  logTranslate.info('batch done', { total: stringIds.length, ok, failed });

  return results;
};

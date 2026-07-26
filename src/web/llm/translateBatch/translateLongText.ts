import { CONFIG } from '../../../config';
import { translateStrings, isLlmResponseTruncatedError } from '../../../llm/translate';
import { maskLlmOptionalText, maskLlmReferenceExamples } from '../../../llm/llmTextMask';
import { logTranslate } from '../../../logging/loggers';
import {
  compareProtectedTokens,
  maskFunctionKeywords,
  maskPlaceholders,
  unmask,
  validateMaskedTranslation,
} from '../../../utils/placeholders';
import type { GameType } from '../../../types';
import { normalizeAutoTranslationDashes } from '../../../utils/textNorm';
import { relevantGlossaryForChunk } from './glossary';
import { splitLongSourceText, needsLongTextSplit } from '../splitLongText';
import type { ChunkTranslateContext, PreparedLlmItem } from './types';

type RagExamples = NonNullable<PreparedLlmItem['llmItem']['reference_examples']>;

export { needsLongTextSplit };

const maskSourcePart = (entry: PreparedLlmItem, partSource: string) => {
  const { masked: placeholderMasked, mapping: placeholderMap } = maskPlaceholders(partSource);
  const { masked: protectedMasked, mapping: functionKeywordMap } = maskFunctionKeywords(
    placeholderMasked,
    (entry.game ?? undefined) as GameType | undefined,
    { grup: entry.grup, field: entry.field },
  );
  return { maskedSource: protectedMasked, placeholderMap, functionKeywordMap };
};

/** Split raw source, re-mask each part with local PH0… keys, return joined unmasked translation. */
const translateParts = async (
  ctx: ChunkTranslateContext,
  entry: PreparedLlmItem,
  parts: readonly string[],
  ragExamples: RagExamples | undefined,
): Promise<string> => {
  const translatedParts: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const partSource = parts[i]!;
    const { maskedSource, placeholderMap, functionKeywordMap } = maskSourcePart(entry, partSource);
    const results = await translateStrings({
      items: [
        {
          ...entry.llmItem,
          source: maskedSource,
          context: maskLlmOptionalText(entry.llmItem.context),
          reference_examples: i === 0 ? maskLlmReferenceExamples(ragExamples) : undefined,
        },
      ],
      model: ctx.model,
      srcLang: ctx.opts.srcLang,
      targetLang: ctx.opts.targetLang,
      game: ctx.opts.modGame ?? entry.game,
      modName: ctx.opts.modName ?? entry.modName,
      glossary: relevantGlossaryForChunk(ctx.glossaryAll, [entry.sourceText]),
      signal: ctx.opts.signal,
    });

    const maskedPart = results[0]!.translation;
    const partMaskCheck = validateMaskedTranslation(maskedPart, {
      ...placeholderMap,
      ...functionKeywordMap,
    });
    if (!partMaskCheck.ok) {
      throw new Error(partMaskCheck.message);
    }

    translatedParts.push(unmask(unmask(maskedPart, functionKeywordMap), placeholderMap));
  }

  return translatedParts.join('');
};

export const finalizeLongTextTranslation = (
  ctx: ChunkTranslateContext,
  entry: PreparedLlmItem,
  translated: string,
): { stringId: number; text: string } | { stringId: number; error: string } => {
  const tokenCheck = compareProtectedTokens(
    entry.sourceText,
    translated,
    (entry.game ?? ctx.opts.modGame) as GameType | undefined,
    { grup: entry.grup, field: entry.field },
  );
  if (!tokenCheck.ok) {
    return { stringId: entry.stringId, error: tokenCheck.message };
  }
  return {
    stringId: entry.stringId,
    text: normalizeAutoTranslationDashes(translated),
  };
};

/** Translate one string by splitting raw source into sequential LLM calls. */
export const translateLongTextItem = async (
  ctx: ChunkTranslateContext,
  entry: PreparedLlmItem,
  ragExamples: RagExamples | undefined,
  maxChars = CONFIG.llmTranslateTextChunkMaxChars,
): Promise<string> => {
  const parts = splitLongSourceText(entry.sourceText, maxChars);
  if (parts.length <= 1) {
    throw new Error(`long-text split produced a single part (id=${entry.stringId})`);
  }

  logTranslate.info('translating long text in parts', {
    stringId: entry.stringId,
    sourceChars: entry.sourceText.length,
    partCount: parts.length,
    maxChars,
  });

  return translateParts(ctx, entry, parts, ragExamples);
};

/** Retry with smaller parts when output was truncated despite fitting input limits. */
export const translateLongTextAfterTruncation = async (
  ctx: ChunkTranslateContext,
  entry: PreparedLlmItem,
  ragExamples: RagExamples | undefined,
): Promise<string | null> => {
  const defaultMax = CONFIG.llmTranslateTextChunkMaxChars;
  const longest = entry.sourceText.length;
  const splitMax = longest > defaultMax ? defaultMax : Math.max(200, Math.floor(longest / 2));

  const parts = splitLongSourceText(entry.sourceText, splitMax);
  if (parts.length <= 1) return null;

  logTranslate.warn('translating long text after truncation', {
    stringId: entry.stringId,
    sourceChars: entry.sourceText.length,
    partCount: parts.length,
    maxChars: splitMax,
  });

  try {
    return await translateParts(ctx, entry, parts, ragExamples);
  } catch (err) {
    if (isLlmResponseTruncatedError(err) && splitMax > 200) {
      return translateLongTextItem(
        ctx,
        entry,
        ragExamples,
        Math.max(200, Math.floor(splitMax / 2)),
      );
    }
    throw err;
  }
};

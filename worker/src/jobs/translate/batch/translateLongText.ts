import { CONFIG } from '../../../../../src/config';
import { translateStrings, isLlmResponseTruncatedError } from '../../../../../src/llm/translate';
import { maskLlmOptionalText, maskLlmReferenceExamples } from '../../../../../src/llm/llmTextMask';
import { logTranslate } from '../../../../../src/logging/loggers';
import {
  compareProtectedTokens,
  maskFunctionKeywords,
  maskPlaceholders,
  unmask,
  validateMaskedTranslation,
} from '../../../../../src/utils/placeholders';
import type { GameType } from '../../../../../src/types';
import { normalizeAutoTranslationDashes } from '../../../../../src/utils/textNorm';
import { relevantGlossaryForChunk } from './glossary';
import {
  splitLongSourceForTranslate,
  splitLongSourceText,
  needsLongTextSplit,
} from '../../shared/splitLongText';
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

const translatePartSourceOnce = async (
  ctx: ChunkTranslateContext,
  entry: PreparedLlmItem,
  partSource: string,
  ragExamples: RagExamples | undefined,
  includeContext: boolean,
): Promise<string> => {
  const { maskedSource, placeholderMap, functionKeywordMap } = maskSourcePart(entry, partSource);
  const results = await translateStrings({
    items: [
      {
        ...entry.llmItem,
        source: maskedSource,
        context: includeContext ? maskLlmOptionalText(entry.llmItem.context) : null,
        reference_examples: includeContext ? maskLlmReferenceExamples(ragExamples) : undefined,
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

  return unmask(unmask(maskedPart, functionKeywordMap), placeholderMap);
};

const translatePartSource = async (
  ctx: ChunkTranslateContext,
  entry: PreparedLlmItem,
  partSource: string,
  ragExamples: RagExamples | undefined,
  includeContext: boolean,
): Promise<string> => {
  try {
    return await translatePartSourceOnce(ctx, entry, partSource, ragExamples, includeContext);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Missing mask key') && partSource.length > 160) {
      const mid = Math.max(1, Math.floor(partSource.length / 2));
      logTranslate.warn('long-text part missing masks — splitting further', {
        stringId: entry.stringId,
        partChars: partSource.length,
        reason: message,
      });
      const left = await translatePartSource(
        ctx,
        entry,
        partSource.slice(0, mid),
        ragExamples,
        false,
      );
      const right = await translatePartSource(
        ctx,
        entry,
        partSource.slice(mid),
        ragExamples,
        false,
      );
      return left + right;
    }
    throw err;
  }
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
    translatedParts.push(await translatePartSource(ctx, entry, parts[i]!, ragExamples, i === 0));
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
  const parts = splitLongSourceForTranslate(entry.sourceText, maxChars);
  if (parts.length === 0) {
    throw new Error(`long-text split produced no parts (id=${entry.stringId})`);
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

  const parts = splitLongSourceForTranslate(entry.sourceText, splitMax);
  if (parts.length <= 1 && entry.sourceText.length <= splitMax) return null;

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

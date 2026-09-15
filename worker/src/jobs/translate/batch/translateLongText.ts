import { CONFIG } from '../../../../../src/config';
import { translateStrings, isLlmResponseTruncatedError } from '../../../../../src/llm/translate';
import { maskLlmOptionalText } from '../../../../../src/llm/llmTextMask';
import {
  applyTranslateSplit,
  isMaskedLlmText,
  splitTranslateSource,
  structureLlmReferenceExamples,
} from '../../../../../src/llm/textParts';
import { logTranslate } from '../../../../../src/logging/loggers';
import {
  compareProtectedTokens,
  unmask,
  validateMaskedTranslation,
} from '../../../../../src/utils/placeholders';
import type { GameId } from '../../../../../src/types';
import { normalizeAutoTranslation } from '../../../../../src/utils/textNorm';
import { relevantGlossaryForChunk } from './glossary';
import { splitLongSourceForTranslate, needsLongTextSplit } from '../../shared/splitLongText';
import type { ChunkTranslateContext, PreparedLlmItem } from './types';

type RagExamples = NonNullable<PreparedLlmItem['llmItem']['reference_examples']>;

export { needsLongTextSplit };

const translatePartSourceOnce = async (
  ctx: ChunkTranslateContext,
  entry: PreparedLlmItem,
  partSource: string,
  ragExamples: RagExamples | undefined,
  includeContext: boolean,
): Promise<string> => {
  const split = splitTranslateSource(partSource, entry.game, {
    grup: entry.grup,
    field: entry.field,
  });
  const results = await translateStrings({
    items: [
      applyTranslateSplit(
        {
          ...entry.llmItem,
          context: includeContext ? maskLlmOptionalText(entry.llmItem.context) : null,
          reference_examples: includeContext
            ? structureLlmReferenceExamples(ragExamples, ctx.opts.modGame ?? entry.game)
            : undefined,
        },
        split,
      ),
    ],
    model: ctx.model,
    srcLang: ctx.opts.srcLang,
    targetLang: ctx.opts.targetLang,
    game: ctx.opts.modGame ?? entry.game,
    modName: ctx.opts.modName ?? entry.modName,
    glossary: await relevantGlossaryForChunk(ctx.glossaryAll, [entry.sourceText]),
    promptFamily: entry.promptFamily,
    dialogScene: entry.dialogScene,
    signal: ctx.opts.signal,
  });

  const assembled = results[0]!.translation;
  if (isMaskedLlmText(assembled)) {
    const partMaskCheck = validateMaskedTranslation(assembled, {
      ...split.placeholderMap,
      ...split.functionKeywordMap,
    });
    if (!partMaskCheck.ok) {
      throw new Error(partMaskCheck.message);
    }
    return unmask(unmask(assembled, split.functionKeywordMap), split.placeholderMap);
  }

  const tokenCheck = compareProtectedTokens(
    partSource,
    assembled,
    entry.game as GameId | undefined,
    { grup: entry.grup, field: entry.field },
  );
  if (!tokenCheck.ok) {
    throw new Error(tokenCheck.message);
  }
  return assembled;
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
    (entry.game ?? ctx.opts.modGame) as GameId | undefined,
    { grup: entry.grup, field: entry.field },
  );
  if (!tokenCheck.ok) {
    return { stringId: entry.stringId, error: tokenCheck.message };
  }
  return {
    stringId: entry.stringId,
    text: normalizeAutoTranslation(
      entry.sourceText,
      translated,
      (entry.game ?? ctx.opts.modGame) as GameId | undefined,
    ),
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

import { CONFIG } from '../../../config';
import { translateStrings, isLlmResponseTruncatedError } from '../../../llm/translate';
import { maskLlmOptionalText, maskLlmReferenceExamples } from '../../../llm/llmTextMask';
import { logTranslate } from '../../../logging/loggers';
import { relevantGlossaryForChunk } from './glossary';
import { splitLongSourceText, needsLongTextSplit } from '../splitLongText';
import type { ChunkTranslateContext, PreparedLlmItem } from './types';

type RagExamples = NonNullable<PreparedLlmItem['llmItem']['reference_examples']>;

export { needsLongTextSplit };

const translateParts = async (
  ctx: ChunkTranslateContext,
  entry: PreparedLlmItem,
  parts: readonly string[],
  ragExamples: RagExamples | undefined,
): Promise<string[]> => {
  const translated: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const results = await translateStrings({
      items: [
        {
          ...entry.llmItem,
          source: part,
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
    translated.push(results[0]!.translation);
  }

  return translated;
};

/** Translate one string by splitting its masked source into sequential LLM calls. */
export const translateLongTextItem = async (
  ctx: ChunkTranslateContext,
  entry: PreparedLlmItem,
  ragExamples: RagExamples | undefined,
  maxChars = CONFIG.llmTranslateTextChunkMaxChars,
): Promise<string> => {
  const parts = splitLongSourceText(entry.llmItem.source, maxChars);
  if (parts.length <= 1) {
    throw new Error(`long-text split produced a single part (id=${entry.stringId})`);
  }

  logTranslate.info('translating long text in parts', {
    stringId: entry.stringId,
    sourceChars: entry.llmItem.source.length,
    partCount: parts.length,
    maxChars,
  });

  const translatedParts = await translateParts(ctx, entry, parts, ragExamples);
  return translatedParts.join('');
};

/** Retry with smaller parts when output was truncated despite fitting input limits. */
export const translateLongTextAfterTruncation = async (
  ctx: ChunkTranslateContext,
  entry: PreparedLlmItem,
  ragExamples: RagExamples | undefined,
): Promise<string | null> => {
  const source = entry.llmItem.source;
  const defaultMax = CONFIG.llmTranslateTextChunkMaxChars;
  const splitMax =
    source.length > defaultMax ? defaultMax : Math.max(200, Math.floor(source.length / 2));

  const parts = splitLongSourceText(source, splitMax);
  if (parts.length <= 1) return null;

  logTranslate.warn('translating long text after truncation', {
    stringId: entry.stringId,
    sourceChars: source.length,
    partCount: parts.length,
    maxChars: splitMax,
  });

  try {
    const translatedParts = await translateParts(ctx, entry, parts, ragExamples);
    return translatedParts.join('');
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

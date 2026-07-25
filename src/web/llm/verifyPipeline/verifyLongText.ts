import { CONFIG } from '../../../config';
import {
  verifyTranslationsWithLlm,
  type LlmVerifyItem,
  type LlmVerifyItemResult,
  type LlmVerifyVerdict,
} from '../../../llm/verifyTranslate';
import { isLlmResponseTruncatedError } from '../../../llm/translate';
import { withRequestDeadline } from '../../../llm/requestDeadline';
import { logVerify } from '../../../logging/loggers';
import { relevantGlossaryEntries } from '../glossaryForLlm';
import { splitLongPairedText } from '../splitLongText';
import type { VerifyChunkContext } from './types';
import type { VerifyStringRow } from './types';

const VERDICT_RANK: Record<LlmVerifyVerdict, number> = {
  ok: 0,
  suspicious: 1,
  incorrect: 2,
};

export const mergeVerifyPartResults = (
  parts: readonly LlmVerifyItemResult[],
  stringId: number,
): LlmVerifyItemResult => {
  if (parts.length === 0) {
    throw new Error(`no verify parts to merge (id=${stringId})`);
  }
  if (parts.length === 1) return parts[0]!;

  let verdict: LlmVerifyVerdict = 'ok';
  let confidence = 1;
  const reasons: string[] = [];
  const suggestions: string[] = [];

  for (const part of parts) {
    if (VERDICT_RANK[part.verdict] > VERDICT_RANK[verdict]) verdict = part.verdict;
    confidence = Math.min(confidence, part.confidence);
    if (part.verdict !== 'ok') reasons.push(part.reason);
    if (part.suggestion) suggestions.push(part.suggestion);
  }

  return {
    id: stringId,
    verdict,
    reason:
      verdict === 'ok'
        ? parts.find((part) => part.reason.trim())?.reason.trim() || 'OK'
        : reasons.join(' '),
    confidence,
    suggestion: verdict === 'ok' ? null : suggestions.join('') || null,
  };
};

const verifyPartOnce = async (
  ctx: VerifyChunkContext,
  item: LlmVerifyItem,
): Promise<LlmVerifyItemResult> => {
  const [result] = await withRequestDeadline(
    CONFIG.llmRequestTimeoutMs,
    ctx.opts.signal,
    (signal) =>
      verifyTranslationsWithLlm({
        items: [item],
        model: ctx.model,
        srcLang: ctx.opts.srcLang,
        targetLang: ctx.opts.targetLang,
        game: ctx.opts.game,
        modName: ctx.opts.modName,
        glossary: relevantGlossaryEntries(ctx.glossaryAll, [item.source]),
        signal,
      }),
  );
  return result!;
};

const verifyParts = async (
  ctx: VerifyChunkContext,
  item: LlmVerifyItem,
  pairs: readonly { source: string; translation: string }[],
): Promise<LlmVerifyItemResult[]> => {
  const results: LlmVerifyItemResult[] = [];

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]!;
    results.push(
      await verifyPartOnce(ctx, {
        ...item,
        source: pair.source,
        translation: pair.translation,
        reference_examples: i === 0 ? item.reference_examples : undefined,
        context: i === 0 ? item.context : null,
      }),
    );
  }

  return results;
};

/** Verify one long string by splitting source/translation into sequential LLM calls. */
export const verifyLongTextItem = async (
  ctx: VerifyChunkContext,
  item: LlmVerifyItem,
  maxChars = CONFIG.llmTranslateTextChunkMaxChars,
): Promise<LlmVerifyItemResult> => {
  const pairs = splitLongPairedText(item.source, item.translation, maxChars);
  if (pairs.length <= 1) {
    throw new Error(`long-text verify split produced a single part (id=${item.id})`);
  }

  logVerify.info('verifying long text in parts', {
    stringId: item.id,
    sourceChars: item.source.length,
    translationChars: item.translation.length,
    partCount: pairs.length,
    maxChars,
  });

  const partResults = await verifyParts(ctx, item, pairs);
  return mergeVerifyPartResults(partResults, item.id);
};

/** Retry with smaller parts when output was truncated despite fitting input limits. */
export const verifyLongTextAfterTruncation = async (
  ctx: VerifyChunkContext,
  item: LlmVerifyItem,
): Promise<LlmVerifyItemResult | null> => {
  const defaultMax = CONFIG.llmTranslateTextChunkMaxChars;
  const longest = Math.max(item.source.length, item.translation.length);
  const splitMax = longest > defaultMax ? defaultMax : Math.max(200, Math.floor(longest / 2));

  const pairs = splitLongPairedText(item.source, item.translation, splitMax);
  if (pairs.length <= 1) return null;

  logVerify.warn('verifying long text after truncation', {
    stringId: item.id,
    sourceChars: item.source.length,
    translationChars: item.translation.length,
    partCount: pairs.length,
    maxChars: splitMax,
  });

  try {
    const partResults = await verifyParts(ctx, item, pairs);
    return mergeVerifyPartResults(partResults, item.id);
  } catch (err) {
    if (isLlmResponseTruncatedError(err) && splitMax > 200) {
      return verifyLongTextItem(ctx, item, Math.max(200, Math.floor(splitMax / 2)));
    }
    throw err;
  }
};

export const rowNeedsLongTextVerify = (row: VerifyStringRow): boolean =>
  row.source.length > CONFIG.llmTranslateTextChunkMaxChars ||
  row.translation.length > CONFIG.llmTranslateTextChunkMaxChars;

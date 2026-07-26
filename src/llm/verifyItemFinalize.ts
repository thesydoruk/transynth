import type { GameType } from '../types';
import { compareProtectedTokens } from '../utils/placeholders';
import { maskLlmTextFields, unmaskLlmText } from './llmTextMask';
import { applyCorruptedTranslationGuard, reconcileVerifyResult } from './verifySuggestionGuards';
import type { LlmVerifyItem, LlmVerifyItemResult } from './verifyTranslateTypes';

/** Mask text fields sent to the verify LLM; keeps raw items for post-audit guards. */
export const maskVerifyItemForLlm = (
  item: LlmVerifyItem,
): { item: LlmVerifyItem; mapping: Record<string, string> } => {
  const fields: Array<string | null | undefined> = [item.source, item.translation];
  for (const ref of item.reference_examples ?? []) {
    fields.push(ref.source, ref.translation);
  }
  if (item.context != null) fields.push(item.context);

  const { masked, mapping } = maskLlmTextFields(fields, { reuseKeysForIdenticalTokens: true });
  let idx = 0;
  const take = (): string => masked[idx++] as string;

  return {
    mapping,
    item: {
      ...item,
      source: take(),
      translation: take(),
      reference_examples: item.reference_examples?.map((ref) => ({
        ...ref,
        source: take(),
        translation: take(),
      })),
      context: item.context != null ? take() : item.context,
    },
  };
};

export const unmaskVerifySuggestions = (
  results: LlmVerifyItemResult[],
  mappingById: Map<number, Record<string, string>>,
): LlmVerifyItemResult[] =>
  results.map((result) => {
    if (!result.suggestion) return result;
    const mapping = mappingById.get(result.id);
    if (!mapping || Object.keys(mapping).length === 0) return result;
    return { ...result, suggestion: unmaskLlmText(result.suggestion, mapping) };
  });

/** Upgrade LLM ok → incorrect only when protected tokens are broken in the translation. */
export const applyPlaceholderGuardToVerifyResult = (
  item: LlmVerifyItem,
  result: LlmVerifyItemResult,
  game?: GameType | string | null,
): LlmVerifyItemResult => {
  const check = compareProtectedTokens(
    item.source,
    item.translation,
    game as GameType | undefined,
    { grup: item.grup, field: item.field },
  );
  if (check.ok) return result;

  if (result.verdict === 'ok') {
    return {
      id: result.id,
      verdict: 'incorrect',
      reason: check.message,
      confidence: Math.max(result.confidence, 0.95),
      suggestion: result.suggestion,
    };
  }

  if (!result.reason.includes('Protected token mismatch')) {
    return {
      ...result,
      reason: `${result.reason} ${check.message}`,
    };
  }

  return result;
};

/** Apply placeholder guard and suggestion reconciliation to parsed LLM rows. */
export const finalizeVerifyItemResults = (
  items: LlmVerifyItem[],
  parsed: LlmVerifyItemResult[],
  game?: GameType | string | null,
): LlmVerifyItemResult[] => {
  const itemById = new Map(items.map((item) => [item.id, item]));
  return parsed.map((result) => {
    const item = itemById.get(result.id);
    if (!item) return result;
    const guarded = applyPlaceholderGuardToVerifyResult(item, result, game);
    const cleaned = applyCorruptedTranslationGuard(item, guarded);
    return reconcileVerifyResult(item, cleaned);
  });
};

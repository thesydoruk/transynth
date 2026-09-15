import type { GameId } from '../types';
import { compareProtectedTokens } from '../utils/placeholders';
import { maskLlmTextFields, unmaskLlmText } from './llmTextMask';
import {
  isMaskedLlmText,
  publicSlotHints,
  splitMaskedToParts,
  splitMaskedUsingKeys,
} from './textParts';
import { gamePlugin } from '../games/registry';
import { describeGenderLeaks, findGenderLeaks } from './genderGuard';
import {
  applyCorruptedTranslationGuard,
  isCorruptedVerifyTranslation,
  isFullTranslationMismatch,
  reconcileVerifyResult,
} from './verifySuggestionGuards';
import type {
  LlmVerifyItem,
  LlmVerifyItemResult,
  LlmVerifyVerdict,
  VerifyDefectKind,
} from './verifyTranslateTypes';

/** Mask text fields sent to the verify LLM; keeps raw items for post-audit guards. */
export const maskVerifyItemForLlm = (
  item: LlmVerifyItem,
  game?: GameId | string | null,
): { item: LlmVerifyItem; mapping: Record<string, string> } => {
  const fields: Array<string | null | undefined> = [item.source, item.translation];
  for (const ref of item.reference_examples ?? []) {
    fields.push(ref.source, ref.translation);
  }
  if (item.context != null) fields.push(item.context);

  const { masked, mapping } = maskLlmTextFields(fields, { reuseKeysForIdenticalTokens: true });
  const withMarkup = masked.map((field) => {
    if (field == null) return null;
    const markup = gamePlugin(game).text.maskMarkup(field);
    Object.assign(mapping, markup.mapping);
    return markup.masked;
  });
  let idx = 0;
  const take = (): string => withMarkup[idx++] as string;

  const source = take();
  const translation = take();
  const sourceSplit = splitMaskedToParts(source, mapping);
  const translationParts = splitMaskedUsingKeys(translation, sourceSplit.keyToIndex);

  const examples = item.reference_examples?.map((ref) => {
    const exSource = take();
    const exTranslation = take();
    const exSplit = splitMaskedToParts(exSource, mapping);
    return {
      ...ref,
      source: exSource,
      translation: exTranslation,
      parts: exSplit.parts,
      translation_parts: splitMaskedUsingKeys(exTranslation, exSplit.keyToIndex),
      slots: publicSlotHints(exSplit.slots),
    };
  });

  return {
    mapping,
    item: {
      ...item,
      source,
      translation,
      parts: sourceSplit.parts,
      translation_parts: translationParts,
      slots: publicSlotHints(sourceSplit.slots),
      sourceParts: sourceSplit.parts,
      restoreSlots: sourceSplit.slots,
      reference_examples: examples,
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
    if (!isMaskedLlmText(result.suggestion)) return result;
    const mapping = mappingById.get(result.id);
    if (!mapping || Object.keys(mapping).length === 0) return result;
    return { ...result, suggestion: unmaskLlmText(result.suggestion, mapping) };
  });

/** Upgrade LLM ok → incorrect only when protected tokens are broken in the translation. */
export const applyPlaceholderGuardToVerifyResult = (
  item: LlmVerifyItem,
  result: LlmVerifyItemResult,
  game?: GameId | string | null,
): LlmVerifyItemResult => {
  const check = compareProtectedTokens(item.source, item.translation, game as GameId | undefined, {
    grup: item.grup,
    field: item.field,
  });
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

/**
 * Sharpen a verdict that missed a gender the metadata rules out, and drop a
 * suggestion that would introduce one.
 *
 * The auditor is asked to check gender agreement and mostly does; the detector
 * is here for the cases it waves through, and for suggestions that fix the
 * reported problem while creating this one.
 */
const applyGenderGuardToVerifyResult = (
  item: LlmVerifyItem,
  result: LlmVerifyItemResult,
  targetLang: string | null | undefined,
): LlmVerifyItemResult => {
  const suggestionLeaks =
    typeof result.suggestion === 'string'
      ? findGenderLeaks(result.suggestion, item, targetLang)
      : [];
  const withoutBadSuggestion =
    suggestionLeaks.length > 0 ? { ...result, suggestion: null } : result;

  const leaks = findGenderLeaks(item.translation, item, targetLang);
  if (leaks.length === 0) return withoutBadSuggestion;
  if (withoutBadSuggestion.verdict === 'incorrect') return withoutBadSuggestion;

  const message = describeGenderLeaks(leaks);
  return {
    ...withoutBadSuggestion,
    verdict: 'suspicious',
    reason: withoutBadSuggestion.reason.includes('Рід:')
      ? withoutBadSuggestion.reason
      : `${withoutBadSuggestion.reason} ${message}`.trim(),
    confidence: Math.max(withoutBadSuggestion.confidence, 0.9),
  };
};

const VERDICT_RANK: Record<LlmVerifyVerdict, number> = { ok: 0, suspicious: 1, incorrect: 2 };

/**
 * Defects the system can prove on its own, checked the same way whatever the
 * model said. The markup check belongs to the game, so it is read from whether
 * the plugin's guard hardened the verdict rather than by asking the plugin a
 * question its contract does not have.
 */
const provenDefects = (
  item: LlmVerifyItem,
  beforeMarkup: LlmVerifyItemResult,
  afterMarkup: LlmVerifyItemResult,
  game?: GameId | string | null,
  targetLang?: string | null,
): VerifyDefectKind[] => {
  const defects: VerifyDefectKind[] = [];
  if (isCorruptedVerifyTranslation(item.translation)) defects.push('corrupted_translation');
  if (
    !compareProtectedTokens(item.source, item.translation, game as GameId | undefined, {
      grup: item.grup,
      field: item.field,
    }).ok
  ) {
    defects.push('protected_token_mismatch');
  }
  if (VERDICT_RANK[afterMarkup.verdict] > VERDICT_RANK[beforeMarkup.verdict]) {
    defects.push('markup_broken');
  }
  if (findGenderLeaks(item.translation, item, targetLang).length > 0) defects.push('gender_leak');
  if (isFullTranslationMismatch(item, game)) defects.push('full_translation_mismatch');
  return defects;
};

/** Apply the placeholder, markup and gender guards, then reconcile suggestions. */
export const finalizeVerifyItemResults = (
  items: LlmVerifyItem[],
  parsed: LlmVerifyItemResult[],
  game?: GameId | string | null,
  targetLang?: string | null,
): LlmVerifyItemResult[] => {
  const itemById = new Map(items.map((item) => [item.id, item]));
  return parsed.map((result) => {
    const item = itemById.get(result.id);
    if (!item) return result;
    const placeholders = applyPlaceholderGuardToVerifyResult(item, result, game);
    const markup = gamePlugin(game).text.guardVerifyResult(item, placeholders);
    const gender = applyGenderGuardToVerifyResult(item, markup, targetLang);
    const cleaned = applyCorruptedTranslationGuard(item, gender);
    const reconciled = reconcileVerifyResult(item, cleaned);
    const defects = provenDefects(item, placeholders, markup, game, targetLang);
    return defects.length > 0 ? { ...reconciled, defects } : reconciled;
  });
};

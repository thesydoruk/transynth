/**
 * Language-agnostic checks on LLM verify suggestions before show/auto-apply.
 */
import type { GameType } from '../types';
import { compareProtectedTokens, type ProtectedTokenContext } from '../utils/placeholders';
import type { LlmVerifyItem, LlmVerifyItemResult } from './verifyTranslate';

const normalizeForCompare = (text: string): string => text.trim().replace(/\s+/g, ' ');

export type SuggestionRejectReason = 'token_mismatch' | 'noop';

export type VerifySuggestionValidation =
  | { ok: true }
  | { ok: false; reason: SuggestionRejectReason; message: string };

const tokenContextFromItem = (item: LlmVerifyItem): ProtectedTokenContext => ({
  grup: item.grup,
  field: item.field,
});

export const validateVerifySuggestion = (
  item: LlmVerifyItem,
  suggestion: string,
  game?: GameType | string | null,
): VerifySuggestionValidation => {
  const tokenCheck = compareProtectedTokens(
    item.source,
    suggestion,
    game as GameType | undefined,
    tokenContextFromItem(item),
  );
  if (!tokenCheck.ok) {
    return { ok: false, reason: 'token_mismatch', message: tokenCheck.message };
  }

  if (normalizeForCompare(suggestion) === normalizeForCompare(item.translation)) {
    return {
      ok: false,
      reason: 'noop',
      message: 'Suggestion equals current translation.',
    };
  }

  return { ok: true };
};

const appendRejectionNote = (reason: string, note: string): string =>
  reason.includes('Suggestion rejected:') ? reason : `${reason} Suggestion rejected: ${note}`;

/** Resolve LLM contradictions before suggestion validation. */
export const reconcileVerifyResult = (
  item: LlmVerifyItem,
  result: LlmVerifyItemResult,
): LlmVerifyItemResult => {
  if (result.verdict === 'ok' || !result.suggestion) return result;

  if (normalizeForCompare(result.suggestion) !== normalizeForCompare(item.translation)) {
    return result;
  }

  if (result.verdict === 'suspicious') {
    return {
      ...result,
      verdict: 'ok',
      suggestion: null,
      reason: `${result.reason} (No actionable fix — suggestion matches current translation.)`,
      confidence: Math.min(result.confidence, 0.85),
    };
  }

  return {
    ...result,
    suggestion: null,
    reason: `${result.reason} (No different fix proposed — suggestion matches current translation.)`,
  };
};

/**
 * Strip invalid LLM suggestions and soften verdicts when the only problem was a bad rewrite.
 */
export const sanitizeVerifyResult = (
  item: LlmVerifyItem,
  result: LlmVerifyItemResult,
  game?: GameType | string | null,
): LlmVerifyItemResult => {
  const reconciled = reconcileVerifyResult(item, result);
  if (reconciled.verdict === 'ok' || !reconciled.suggestion) return reconciled;

  const validation = validateVerifySuggestion(item, reconciled.suggestion, game);
  if (validation.ok) return reconciled;

  const reason = appendRejectionNote(reconciled.reason, validation.message);
  const translationTokensOk = compareProtectedTokens(
    item.source,
    item.translation,
    game as GameType | undefined,
    tokenContextFromItem(item),
  ).ok;

  if (
    translationTokensOk &&
    (validation.reason === 'noop' || reconciled.verdict === 'suspicious')
  ) {
    return {
      ...reconciled,
      verdict: 'ok',
      suggestion: null,
      reason,
      confidence: Math.min(reconciled.confidence, 0.75),
    };
  }

  return {
    ...reconciled,
    suggestion: null,
    reason,
  };
};

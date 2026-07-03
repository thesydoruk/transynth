/**
 * Minimal guards on LLM verify suggestions before auto-apply.
 * Verdict quality is delegated to the LLM; only token safety and noop are checked here.
 */
import type { GameType } from '../types';
import { compareProtectedTokens, type ProtectedTokenContext } from '../utils/placeholders';
import type { LlmVerifyItem, LlmVerifyItemResult, LlmVerifyVerdict } from './verifyTranslate';

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

export type VerifyFixAction =
  | { kind: 'none' }
  | { kind: 'flag_only' }
  | { kind: 'apply'; suggestion: string }
  | { kind: 'reject_fix'; suggestion: string; message: string };

/** Decide whether an LLM suggestion should be auto-applied. */
export const resolveVerifyFixAction = (
  item: LlmVerifyItem,
  verdict: LlmVerifyVerdict,
  suggestion: string | null,
  fixSuspicious: boolean,
  _game?: GameType | string | null,
): VerifyFixAction => {
  if (verdict === 'ok') return { kind: 'none' };

  const wantsFix =
    !!suggestion && (verdict === 'incorrect' || (verdict === 'suspicious' && fixSuspicious));
  if (!wantsFix) return { kind: 'flag_only' };

  const check = validateVerifySuggestion(item, suggestion, _game);
  if (!check.ok) {
    return { kind: 'reject_fix', suggestion, message: check.message };
  }

  return { kind: 'apply', suggestion };
};

export const formatVerifyIssuePrefix = (dryRun: boolean, action: VerifyFixAction): string => {
  switch (action.kind) {
    case 'apply':
      return dryRun ? 'Would fix' : 'Fixed';
    case 'reject_fix':
      return dryRun ? 'Would flag (fix rejected)' : 'Flagged (fix rejected)';
    case 'flag_only':
      return dryRun ? 'Would flag' : 'Flagged';
    default:
      return dryRun ? 'Would flag' : 'Flagged';
  }
};

/** Resolve LLM contradictions before applying a fix. */
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

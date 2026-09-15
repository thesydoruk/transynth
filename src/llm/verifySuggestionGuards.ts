/**
 * Minimal guards on LLM verify suggestions before auto-apply.
 * Verdict quality is delegated to the LLM; only token safety and noop are checked here.
 */
import type { GameId } from '../types';
import {
  compareProtectedTokens,
  extractProtectedTokens,
  type ProtectedTokenContext,
} from '../utils/placeholders';
import type { LlmVerifyItem, LlmVerifyItemResult, LlmVerifyVerdict } from './verifyTranslateTypes';

const normalizeForCompare = (text: string): string => text.trim().replace(/\s+/g, ' ');

export type SuggestionRejectReason = 'token_mismatch' | 'noop' | 'json_artifact' | 'truncated';

export type VerifySuggestionValidation =
  | { ok: true }
  | { ok: false; reason: SuggestionRejectReason; message: string };

const REWRITE_UNCHANGED_MESSAGE = 'Rewrite unchanged translation.';

/** True when a source rewrite reproduced the current translation — treat as verified. */
export const isRewriteUnchangedConfirmation = (check: VerifySuggestionValidation): boolean =>
  !check.ok && check.reason === 'noop' && check.message === REWRITE_UNCHANGED_MESSAGE;

/** True when text looks like a raw verify item JSON object echoed into suggestion. */
export const looksLikeVerifyJsonArtifact = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return typeof parsed.verdict === 'string' && parsed.id != null;
  } catch {
    return /^\{\s*"id"\s*:\s*\d+/.test(trimmed) && /"verdict"\s*:/.test(trimmed);
  }
};

/** True when a verify patch suggestion skips lines with a standalone ellipsis marker. */
export const looksLikeTruncatedSuggestion = (text: string): boolean =>
  /\n\s*\.\.\.\s*(?:\n|$)/.test(text) || /\.\.\.\s*$/.test(text.trim());

/** Unwrap nested verify JSON artifacts; returns null when nothing usable remains. */
export const normalizeVerifySuggestionText = (value: string): string | null => {
  let text = value.trim();
  if (!text) return null;

  if (looksLikeVerifyJsonArtifact(text)) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed.suggestion !== 'string') return null;
      text = parsed.suggestion.trim();
      if (!text) return null;
    } catch {
      return null;
    }
  }

  return text;
};

/** Parse suggestion from a verify LLM row. */
export const parseVerifySuggestionValue = (
  value: unknown,
  verdict: LlmVerifyVerdict,
): string | null => {
  if (verdict === 'ok') return null;
  if (typeof value !== 'string') return null;
  return normalizeVerifySuggestionText(value);
};

const tokenContextFromItem = (item: LlmVerifyItem): ProtectedTokenContext => ({
  grup: item.grup,
  field: item.field,
});

/** Short source paired with a much longer translation that contains alien protected tokens. */
export const isFullTranslationMismatch = (
  item: LlmVerifyItem,
  game?: GameId | string | null,
): boolean => {
  const ctx = tokenContextFromItem(item);
  if (compareProtectedTokens(item.source, item.translation, game as GameId | undefined, ctx).ok) {
    return false;
  }

  const srcTokens = extractProtectedTokens(item.source, game as GameId | undefined, ctx);
  const trTokens = extractProtectedTokens(item.translation, game as GameId | undefined, ctx);
  const srcSet = new Set(srcTokens);
  const extraInTranslation = trTokens.some((token) => !srcSet.has(token));
  if (!extraInTranslation) return false;

  const srcLen = item.source.trim().length;
  const trLen = item.translation.trim().length;
  if (srcTokens.length === 0) return true;
  return srcLen <= 48 && trLen >= srcLen * 4;
};

const isMultiLineSource = (source: string): boolean => /\r?\n/.test(source.trim());

/** Translation field polluted with a verify JSON object (often truncated). */
export const isCorruptedVerifyTranslation = (translation: string): boolean =>
  looksLikeVerifyJsonArtifact(translation);

/** Validate text produced by verify source rewrite (not a patch suggestion). */
export const validateRewrittenTranslation = (
  item: LlmVerifyItem,
  text: string,
  game?: GameId | string | null,
): VerifySuggestionValidation => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, reason: 'noop', message: 'Empty rewritten translation.' };
  }
  if (looksLikeVerifyJsonArtifact(trimmed)) {
    return {
      ok: false,
      reason: 'json_artifact',
      message: 'Rewritten translation is a verify JSON object.',
    };
  }

  const tokenCheck = compareProtectedTokens(
    item.source,
    trimmed,
    game as GameId | undefined,
    tokenContextFromItem(item),
  );
  if (!tokenCheck.ok) {
    return { ok: false, reason: 'token_mismatch', message: tokenCheck.message };
  }

  if (
    !isCorruptedVerifyTranslation(item.translation) &&
    normalizeForCompare(trimmed) === normalizeForCompare(item.translation)
  ) {
    return { ok: false, reason: 'noop', message: REWRITE_UNCHANGED_MESSAGE };
  }

  return { ok: true };
};

/** Re-translate source from scratch instead of patching an incorrect translation. */
export const shouldRewriteFromSource = (
  item: LlmVerifyItem,
  verdict: LlmVerifyVerdict,
  suggestion: string | null,
  fixSuspicious: boolean,
  _game?: GameId | string | null,
): boolean => {
  if (isCorruptedVerifyTranslation(item.translation)) return true;
  // An 'incorrect' verdict means the translation is beyond patching. The model is
  // asked for a fresh translation of the source; re-translate only when it gave none.
  if (verdict === 'incorrect') return !suggestion;
  if (verdict === 'suspicious' && fixSuspicious && !suggestion && isMultiLineSource(item.source)) {
    return true;
  }
  return false;
};

export const validateVerifySuggestion = (
  item: LlmVerifyItem,
  suggestion: string,
  game?: GameId | string | null,
): VerifySuggestionValidation => {
  if (looksLikeVerifyJsonArtifact(suggestion)) {
    return {
      ok: false,
      reason: 'json_artifact',
      message: 'Suggestion is a verify JSON object, not translated text.',
    };
  }

  if (looksLikeTruncatedSuggestion(suggestion)) {
    return {
      ok: false,
      reason: 'truncated',
      message: 'Suggestion contains ellipsis truncation.',
    };
  }

  const tokenCheck = compareProtectedTokens(
    item.source,
    suggestion,
    game as GameId | undefined,
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
  | { kind: 'reject_fix'; suggestion: string; message: string }
  | { kind: 'rewrite_from_source' }
  | { kind: 'approve_as_ok' };

/** Decide whether an LLM suggestion should be auto-applied. */
export const resolveVerifyFixAction = (
  item: LlmVerifyItem,
  verdict: LlmVerifyVerdict,
  suggestion: string | null,
  fixSuspicious: boolean,
  _game?: GameId | string | null,
): VerifyFixAction => {
  if (isCorruptedVerifyTranslation(item.translation)) {
    return { kind: 'rewrite_from_source' };
  }
  if (verdict === 'ok') return { kind: 'none' };

  if (shouldRewriteFromSource(item, verdict, suggestion, fixSuspicious, _game)) {
    return { kind: 'rewrite_from_source' };
  }

  // 'incorrect' is always repaired — without a usable suggestion it already fell
  // through to rewrite_from_source above. 'suspicious' is repaired only on request.
  const wantsFix =
    !!suggestion && (verdict === 'incorrect' || (verdict === 'suspicious' && fixSuspicious));
  if (!wantsFix) return { kind: 'flag_only' };

  const check = validateVerifySuggestion(item, suggestion, _game);
  if (!check.ok) {
    if (check.reason === 'noop') {
      // A translation called incorrect cannot be approved by restating it.
      return verdict === 'incorrect' ? { kind: 'rewrite_from_source' } : { kind: 'approve_as_ok' };
    }
    if (
      check.reason === 'json_artifact' ||
      check.reason === 'truncated' ||
      check.reason === 'token_mismatch'
    ) {
      return { kind: 'rewrite_from_source' };
    }
    return { kind: 'reject_fix', suggestion, message: check.message };
  }

  return { kind: 'apply', suggestion };
};

/** Upgrade corrupted translations saved as verify JSON blobs. */
export const applyCorruptedTranslationGuard = (
  item: LlmVerifyItem,
  result: LlmVerifyItemResult,
): LlmVerifyItemResult => {
  if (!isCorruptedVerifyTranslation(item.translation)) return result;
  if (result.verdict === 'incorrect' && !result.suggestion) return result;

  return {
    id: result.id,
    verdict: 'incorrect',
    reason: `${result.reason} (Translation field contains verify JSON artifact.)`,
    confidence: Math.max(result.confidence, 0.99),
    suggestion: null,
  };
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

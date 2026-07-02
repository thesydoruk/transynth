/**
 * Language-agnostic checks on LLM verify suggestions before show/auto-apply.
 */
import type { GameType } from '../types';
import { compareProtectedTokens, type ProtectedTokenContext } from '../utils/placeholders';
import type { LlmVerifyItem, LlmVerifyItemResult } from './verifyTranslate';

const normalizeForCompare = (text: string): string => text.trim().replace(/\s+/g, ' ');

const hasUkWord = (text: string, word: string): boolean => {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}])${escaped}(?:[^\\p{L}]|$)`, 'iu').test(text);
};

export type SuggestionRejectReason =
  | 'token_mismatch'
  | 'noop'
  | 'introduced_latin'
  | 'invalid_term'
  | 'terminology_swap'
  | 'oververbose';

export type VerifySuggestionValidation =
  | { ok: true }
  | { ok: false; reason: SuggestionRejectReason; message: string };

const LATIN_TOKEN = /[A-Za-z][A-Za-z0-9_-]{2,}/g;

/** Latin tokens allowed in Ukrainian UI even when absent from a short source label. */
const LATIN_ALLOWLIST = new Set([
  'pip',
  'boy',
  'pipboy',
  'tesla',
  'os',
  'hp',
  'ap',
  'xp',
  'mk',
  'ii',
  'iii',
  'iv',
  'v',
  'vi',
  'vii',
  'viii',
  'ix',
  'x',
  'dna',
  'cpu',
  'gpu',
  'usb',
  'admin',
  'holotape',
  'vaul',
  'tec',
  'hack',
]);

const tokenContextFromItem = (item: LlmVerifyItem): ProtectedTokenContext => ({
  grup: item.grup,
  field: item.field,
});

const latinTokens = (text: string): string[] => {
  const matches = text.match(LATIN_TOKEN);
  return matches ? matches.map((token) => token.toLowerCase()) : [];
};

const isBarrelContext = (item: LlmVerifyItem): boolean =>
  /barrel|ствол|stvol/i.test(item.source) ||
  /barrel|ствол|stvol/i.test(item.translation) ||
  /barrel/i.test(item.edid ?? '');

const isFmrnContext = (item: LlmVerifyItem): boolean =>
  item.field === 'FMRN' || item.grup === 'RACE';

const isWeaponStatContext = (item: LlmVerifyItem): boolean =>
  item.grup === 'WEAP' ||
  item.grup === 'OMOD' ||
  item.grup === 'MGEF' ||
  item.field === 'DESC' ||
  item.field === 'CNAM' ||
  /damage|шкода|урон|accuracy|точність|range|дальність/i.test(item.source);

const checkIntroducedLatin = (
  item: LlmVerifyItem,
  suggestion: string,
): VerifySuggestionValidation | null => {
  const sourceLatin = new Set(latinTokens(item.source));
  for (const token of latinTokens(suggestion)) {
    if (sourceLatin.has(token) || LATIN_ALLOWLIST.has(token)) continue;
    return {
      ok: false,
      reason: 'introduced_latin',
      message: `Suggestion introduces Latin token "${token}" not present in source.`,
    };
  }
  return null;
};

const checkWeaponBarrelTerms = (
  item: LlmVerifyItem,
  suggestion: string,
): VerifySuggestionValidation | null => {
  if (!isBarrelContext(item)) return null;

  if (hasUkWord(suggestion, 'стівол')) {
    return {
      ok: false,
      reason: 'invalid_term',
      message: 'Use "ствол", not non-standard "стівол".',
    };
  }

  if (hasUkWord(suggestion, 'стіл') && !hasUkWord(item.source, 'стіл')) {
    return {
      ok: false,
      reason: 'invalid_term',
      message: '"Стіл" (table) is wrong for weapon barrel context; use "ствол".',
    };
  }

  return null;
};

const checkDamageTermSwap = (
  item: LlmVerifyItem,
  suggestion: string,
): VerifySuggestionValidation | null => {
  if (!isWeaponStatContext(item) || !/damage|шкода|урон/i.test(item.source)) return null;

  const translationUsesShkoda = /шкод/i.test(item.translation);
  const suggestionUsesShkoda = /шкод/i.test(suggestion);
  const suggestionUsesUron = hasUkWord(suggestion, 'урон') || /ушкоджен/i.test(suggestion);
  const translationUsesUron =
    hasUkWord(item.translation, 'урон') || /ушкоджен/i.test(item.translation);

  if (
    translationUsesShkoda &&
    !suggestionUsesShkoda &&
    suggestionUsesUron &&
    !translationUsesUron
  ) {
    return {
      ok: false,
      reason: 'terminology_swap',
      message: 'Do not replace project-standard "шкода" with "урон"/"ушкодження".',
    };
  }

  return null;
};

const FMRN_VERBOSE = /(?:основна|середня|нижня|верхня)\s+частина/i;

const checkFmrnOververbose = (
  item: LlmVerifyItem,
  suggestion: string,
): VerifySuggestionValidation | null => {
  if (!isFmrnContext(item)) return null;

  const sourceWords = item.source.trim().split(/\s+/).length;
  if (sourceWords > 4) return null;

  const expandsLabel =
    FMRN_VERBOSE.test(suggestion) &&
    !FMRN_VERBOSE.test(item.translation) &&
    !/\bpart\b/i.test(item.source);

  if (expandsLabel) {
    return {
      ok: false,
      reason: 'oververbose',
      message:
        'FMRN morph labels should stay compact; do not expand to "… частина …" when source has no "Part".',
    };
  }

  const maxLen = Math.max(item.translation.length, item.source.length);
  if (
    maxLen > 0 &&
    suggestion.length > maxLen * 2.2 &&
    suggestion.split(/\s+/).length > item.translation.split(/\s+/).length + 2
  ) {
    return {
      ok: false,
      reason: 'oververbose',
      message: 'Suggestion is too verbose for a face-morph slider label.',
    };
  }

  return null;
};

const checkAccusativeObject = (
  item: LlmVerifyItem,
  suggestion: string,
): VerifySuggestionValidation | null => {
  if (!/можна забрати|забрати/i.test(suggestion)) return null;
  if (/Тесла-гармат[^уаie]/i.test(suggestion) && !/Тесла-гармату/i.test(suggestion)) {
    return {
      ok: false,
      reason: 'invalid_term',
      message: 'After "забрати" use accusative "Тесла-гармату", not "Тесла-гармат".',
    };
  }
  return null;
};

const runQualityChecks = (
  item: LlmVerifyItem,
  suggestion: string,
): VerifySuggestionValidation | null =>
  checkIntroducedLatin(item, suggestion) ??
  checkWeaponBarrelTerms(item, suggestion) ??
  checkDamageTermSwap(item, suggestion) ??
  checkFmrnOververbose(item, suggestion) ??
  checkAccusativeObject(item, suggestion);

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

  const quality = runQualityChecks(item, suggestion);
  if (quality) return quality;

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

const shouldSoftenRejectedSuggestion = (
  validation: Extract<VerifySuggestionValidation, { ok: false }>,
  reconciled: LlmVerifyItemResult,
  translationTokensOk: boolean,
): boolean =>
  translationTokensOk &&
  (validation.reason === 'noop' ||
    reconciled.verdict === 'suspicious' ||
    validation.reason === 'introduced_latin' ||
    validation.reason === 'invalid_term' ||
    validation.reason === 'terminology_swap' ||
    validation.reason === 'oververbose');

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

  if (shouldSoftenRejectedSuggestion(validation, reconciled, translationTokensOk)) {
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

/**
 * Language-agnostic checks on LLM verify suggestions before show/auto-apply.
 */
import type { GameType } from '../types';
import { compareProtectedTokens, type ProtectedTokenContext } from '../utils/placeholders';
import type { LlmGlossaryEntry } from './translate';
import type { LlmVerifyItem, LlmVerifyItemResult, LlmVerifyVerdict } from './verifyTranslate';
import { findGlossaryViolation, resolveGlossaryFixSuggestion } from './glossaryVerify';

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
  text: string,
): VerifySuggestionValidation | null => {
  if (!isBarrelContext(item)) return null;

  if (hasUkWord(text, 'стівол')) {
    return {
      ok: false,
      reason: 'invalid_term',
      message: 'Use "ствол", not non-standard "стівол".',
    };
  }

  if (hasUkWord(text, 'стіл') && !hasUkWord(item.source, 'стіл')) {
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
  text: string,
): VerifySuggestionValidation | null => {
  if (!/можна забрати|забрати/i.test(text)) return null;
  if (/Тесла-гармат[^уаie]/i.test(text) && !/Тесла-гармату/i.test(text)) {
    return {
      ok: false,
      reason: 'invalid_term',
      message: 'After "забрати" use accusative "Тесла-гармату", not "Тесла-гармат".',
    };
  }
  return null;
};

/** Short TERM/BTXT rows with unrelated long translations (typical TM edid mismatch). */
const checkSemanticLengthMismatch = (item: LlmVerifyItem): VerifySuggestionValidation | null => {
  if (item.grup !== 'TERM' && item.field !== 'BTXT') return null;

  const srcLen = item.source.trim().length;
  const trLen = item.translation.trim().length;
  if (srcLen <= 0 || srcLen > 80) return null;

  if (srcLen <= 20 && trLen > srcLen * 3 && trLen > srcLen + 15) {
    return {
      ok: false,
      reason: 'invalid_term',
      message:
        'Translation is far longer than the short terminal source (possible TM/EDID mismatch).',
    };
  }

  const maxLen = Math.max(srcLen * 4, srcLen + 120);
  if (trLen > maxLen) {
    return {
      ok: false,
      reason: 'invalid_term',
      message:
        'Translation is far longer than the short terminal source (possible TM/EDID mismatch).',
    };
  }

  return null;
};

const runQualityChecks = (item: LlmVerifyItem, text: string): VerifySuggestionValidation | null =>
  checkIntroducedLatin(item, text) ??
  checkWeaponBarrelTerms(item, text) ??
  checkDamageTermSwap(item, text) ??
  checkFmrnOververbose(item, text) ??
  checkAccusativeObject(item, text);

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

/** Deterministic checks on the current translation (used before auto-approve). */
export const validateTranslationForVerify = (
  item: LlmVerifyItem,
  game?: GameType | string | null,
  glossary?: LlmGlossaryEntry[],
): VerifySuggestionValidation => {
  const tokenCheck = compareProtectedTokens(
    item.source,
    item.translation,
    game as GameType | undefined,
    tokenContextFromItem(item),
  );
  if (!tokenCheck.ok) {
    return { ok: false, reason: 'token_mismatch', message: tokenCheck.message };
  }

  const semantic = checkSemanticLengthMismatch(item);
  if (semantic) return semantic;

  const quality = runQualityChecks(item, item.translation);
  if (quality) return quality;

  if (glossary && glossary.length > 0) {
    const violation = findGlossaryViolation(item.source, item.translation, glossary);
    if (violation) {
      return {
        ok: false,
        reason: 'invalid_term',
        message: `Glossary: "${violation.term}" should be translated as "${violation.translation}".`,
      };
    }
  }

  return { ok: true };
};

export type VerifyFixAction =
  | { kind: 'none' }
  | { kind: 'flag_only' }
  | { kind: 'apply'; suggestion: string }
  | { kind: 'reject_fix'; suggestion: string; message: string };

/** Decide whether an LLM suggestion should be auto-applied (after guard validation). */
export const resolveVerifyFixAction = (
  item: LlmVerifyItem,
  verdict: LlmVerifyVerdict,
  suggestion: string | null,
  fixSuspicious: boolean,
  game?: GameType | string | null,
): VerifyFixAction => {
  if (verdict === 'ok') return { kind: 'none' };

  const wantsFix =
    !!suggestion && (verdict === 'incorrect' || (verdict === 'suspicious' && fixSuspicious));
  if (!wantsFix) return { kind: 'flag_only' };

  const check = validateVerifySuggestion(item, suggestion, game);
  if (!check.ok) {
    return { kind: 'reject_fix', suggestion, message: check.message };
  }

  return { kind: 'apply', suggestion };
};

/** Apply glossary-based correction when the current translation violates canonical terms. */
export const resolveGlossaryCorrection = (
  item: LlmVerifyItem,
  glossary: LlmGlossaryEntry[],
  game?: GameType | string | null,
): VerifyFixAction => {
  const txCheck = validateTranslationForVerify(item, game, glossary);
  if (txCheck.ok) return { kind: 'none' };

  const suggestion = resolveGlossaryFixSuggestion(item.source, item.translation, glossary);
  if (!suggestion) return { kind: 'flag_only' };

  return resolveVerifyFixAction(item, 'incorrect', suggestion, true, game);
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
  item: LlmVerifyItem,
  translationTokensOk: boolean,
  game?: GameType | string | null,
): boolean => {
  if (!translationTokensOk) return false;
  // Never dismiss a hard incorrect verdict just because the LLM fix was bad.
  if (reconciled.verdict === 'incorrect') return false;
  if (reconciled.verdict !== 'suspicious') return false;

  // If the translation itself still fails deterministic checks, keep it flagged.
  if (!validateTranslationForVerify(item, game).ok) return false;

  // LLM proposed a bad rewrite for an otherwise acceptable translation.
  return (
    validation.reason === 'noop' ||
    validation.reason === 'introduced_latin' ||
    validation.reason === 'invalid_term' ||
    validation.reason === 'terminology_swap' ||
    validation.reason === 'oververbose' ||
    validation.reason === 'token_mismatch'
  );
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

  if (shouldSoftenRejectedSuggestion(validation, reconciled, item, translationTokensOk, game)) {
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

import type { GameType } from '../types';
import { getFunctionKeywordsForGame } from '../resources/functionKeywords';

// Protects placeholders and tags so the model does not alter them.
// Mask format is ¤PH0¤, ¤GL0¤, and ¤FK0¤ for easy post-replacement.

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Inventory/UI bracket prefixes that must survive translation unchanged. */
const UI_BRACKET_TAGS = [
  'Other',
  'Mod',
  'SS2',
  'NoteMisc',
  'Note',
  'Scrap',
  'Valuable',
  'NonHuman',
  'SS2C2',
  'SS',
  'Underwear',
  'HolotapeV',
  'Key',
  'FullOutfit',
  'FullArmor',
  'Vegetables',
  'PerkMag',
  'FO76',
  'IR',
  'Beer',
  'Leaf',
  'SS2C3',
  'Click',
  'CQ',
  'Accept',
  'Password',
  'Activate',
  'Nuka',
  'Hat',
  'pagebreak',
  'SetCustom',
  'Conversion',
  'HolotapeT',
  'Skilled',
  'Gifted',
  'Hi-Tech Farm',
  'Requires Gifted Endurance',
] as const;

/**
 * Regex building blocks for {@link PLACEHOLDER_RE}, ordered most-specific first.
 * Keep in sync with the web UI highlighter (`getPlaceholderParts.ts`).
 */
export const PLACEHOLDER_PATTERN_PARTS = [
  String.raw`\r\n`,
  String.raw`\r`,
  String.raw`\n`,
  String.raw`<font color='#<Global=[^>]+>'>`,
  String.raw`<font color='#<Global=[^>]+>`,
  String.raw`<Token\.[^>]+>`,
  String.raw`<Alias=[^>]+>`,
  String.raw`<Global=[^>]+>`,
  String.raw`<[^>]+>`,
  String.raw`\[(?:${UI_BRACKET_TAGS.map(escapeRegex).join('|')})\]`,
  String.raw`\[\*[A-Za-z]+\]`,
  String.raw`\[<[^>]+>\]`,
  String.raw`\[[A-Za-z][A-Za-z0-9]*:[0-9A-Fa-f]+\]`,
  String.raw`%%`,
  String.raw`%\d+\.\d+[sdif]`,
  String.raw`%\.\d+[sdif]`,
  String.raw`%\d*\$?[sdif]`,
  String.raw`\{[0-9]+\}`,
  String.raw`\{[A-Za-z_][A-Za-z0-9_]*\}`,
  String.raw`\$[A-Za-z_][A-Za-z0-9_]*`,
] as const;

/**
 * Regular expression that matches the generic placeholder and tag patterns Transynth protects
 * from modification during LLM translation.
 *
 * Covered patterns:
 * - `\r\n`, `\r`, `\n` — line breaks.
 * - `%d`, `%s`, `%2$s`, `%.0f`, `%%`, etc. — printf-style format specifiers.
 * - `{0}`, `{1}`, … — positional format tokens.
 * - `{name}` — named format tokens.
 * - UI bracket tags (`[Mod]`, `[*Class]`, form refs) — not stage directions like `[Sarcasm]`.
 * - `<tag>` — XML/HTML-like and Bethesda alias/token/global tags.
 * - `$Identifier` — script-style variable references.
 */
export const PLACEHOLDER_RE = new RegExp(PLACEHOLDER_PATTERN_PARTS.join('|'), 'g');

const IDENTIFIER_RE = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
const SCRIPT_PUNCTUATION_RE = /::|->|[()[\]=,;+\-/*]/;
const DECLARATION_SIGNAL_RE =
  /\b(?:Auto|AutoReadOnly|Conditional|Event|EndEvent|EndFunction|Function|Hidden|Property|ScriptName|State)\b/;

/**
 * Result of a masking operation.
 *
 * @field masked   - Source text with protected tokens replaced by opaque keys.
 * @field mapping  - Map from each opaque key back to its original token value.
 */
type MaskResult = {
  masked: string;
  mapping: Record<string, string>;
};

type KeywordMatch = {
  index: number;
  token: string;
};

const hasCodeLikeKeywordShape = (token: string): boolean => /[a-z][A-Z]|[A-Z]{2,}|\d/.test(token);

const overlapsRange = (
  index: number,
  token: string,
  ranges: Array<{ start: number; end: number }>,
): boolean => ranges.some((range) => index < range.end && index + token.length > range.start);

/** Remove already-protected tokens before deciding whether text looks like Papyrus code. */
const stripProtectedForScriptCheck = (text: string): string => text.replace(PLACEHOLDER_RE, ' ');

/**
 * Strip model/version tokens (X-02, T-51, Mk.II) so their hyphens/dots do not
 * mark item names as script-like. UI inventory badges like [Mod] are already
 * removed by {@link stripProtectedForScriptCheck}.
 */
const stripModelAndVersionTokensForScriptCheck = (text: string): string =>
  text
    .replace(/\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\b/g, ' ')
    .replace(/\b[A-Za-z]+(?:\.[A-Za-z0-9]+)+\b/g, ' ');

const buildScriptProbe = (text: string): string =>
  stripModelAndVersionTokensForScriptCheck(stripProtectedForScriptCheck(text));

const findFunctionKeywordMatches = (text: string, game?: GameType | null): KeywordMatch[] => {
  const keywords = getFunctionKeywordsForGame(game);
  if (keywords.length === 0) return [];

  const keywordSet = new Set(keywords);
  const protectedRanges = Array.from(text.matchAll(PLACEHOLDER_RE)).map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
  const matches = Array.from(text.matchAll(IDENTIFIER_RE)).map((match) => ({
    index: match.index ?? 0,
    token: match[0],
  }));
  const keywordMatches = matches.filter((match) => keywordSet.has(match.token));
  const externalKeywordMatches = keywordMatches.filter(
    (match) => !overlapsRange(match.index, match.token, protectedRanges),
  );
  if (externalKeywordMatches.length === 0) return [];

  const scriptProbe = buildScriptProbe(text);
  const isScriptLike =
    SCRIPT_PUNCTUATION_RE.test(scriptProbe) ||
    DECLARATION_SIGNAL_RE.test(scriptProbe) ||
    externalKeywordMatches.some((match) => hasCodeLikeKeywordShape(match.token));

  return isScriptLike ? externalKeywordMatches : [];
};

/**
 * Replace all generic placeholder tokens in `text` with opaque mask keys.
 *
 * Mask keys have the form `¤PH0¤`, `¤PH1¤`, etc. The returned mapping allows
 * {@link unmask} to restore the originals after translation.
 *
 * @param text - Source text that may contain placeholders matched by {@link PLACEHOLDER_RE}.
 * @returns Masked text and the key-to-original mapping.
 */
export const maskPlaceholders = (text: string) => {
  const mapping: Record<string, string> = {};
  let i = 0;
  const masked = text.replace(PLACEHOLDER_RE, (m) => {
    const key = `¤PH${i}¤`;
    mapping[key] = m;
    i++;
    return key;
  });
  return { masked, mapping };
};

/**
 * Mask script-safe FunctionKeywords tokens for code-like strings.
 * Only keywords in script-looking contexts are masked to avoid freezing
 * ordinary English words such as "Book" or "Class" in normal dialogue.
 *
 * @param text - Source text sent to translation.
 * @param game - Active game identifier for the keyword corpus.
 * @returns Masked text and the restoration mapping.
 */
export const maskFunctionKeywords = (text: string, game?: GameType | null): MaskResult => {
  const matches = findFunctionKeywordMatches(text, game);
  if (matches.length === 0) {
    return { masked: text, mapping: {} };
  }

  const mapping: Record<string, string> = {};
  let cursor = 0;
  let masked = '';

  matches.forEach((match, index) => {
    const key = `¤FK${index}¤`;
    masked += text.slice(cursor, match.index) + key;
    mapping[key] = match.token;
    cursor = match.index + match.token.length;
  });

  masked += text.slice(cursor);
  return { masked, mapping };
};

/**
 * Extract all protected tokens that must survive translation unchanged.
 * This includes generic placeholders and code-like FunctionKeywords.
 *
 * @param text - Raw source or translated text.
 * @param game - Active game identifier for the keyword corpus.
 * @returns Sorted token list for QA comparisons.
 */
export const extractProtectedTokens = (text: string, game?: GameType | null): string[] => {
  const placeholderMatches = text.match(PLACEHOLDER_RE) ?? [];
  const keywordMatches = findFunctionKeywordMatches(text, game).map((match) => match.token);
  return [...placeholderMatches, ...keywordMatches].sort();
};

/**
 * Replace exact glossary term occurrences in `text` with opaque mask keys.
 *
 * Mask keys have the form `¤GL0¤`, `¤GL1¤`, etc. Only the first occurrence of
 * each term is masked per call. Use {@link unmask} to restore the originals.
 *
 * @param text     - Source text that may contain glossary terms.
 * @param glossary - Ordered list of exact-match terms to protect.
 * @returns Masked text and the key-to-original mapping.
 */
export const applyGlossaryMask = (text: string, glossary: string[]) => {
  const map: Record<string, string> = {};
  let out = text;
  glossary.forEach((term, i) => {
    if (!term) return;
    const key = `¤GL${i}¤`;
    if (out.includes(term)) {
      out = out.split(term).join(key);
      map[key] = term;
    }
  });
  return { masked: out, mapping: map };
};

/**
 * Restore all masked tokens in a (translated) string using a key-to-original mapping.
 *
 * Keys are sorted longest-first to prevent partial substitution (e.g. `¤PH10¤`
 * being partially matched before `¤PH1¤`).
 *
 * @param text    - Translated text containing opaque mask keys.
 * @param mapping - Key-to-original mapping produced by a prior masking call.
 * @returns Text with all mask keys replaced by their original tokens.
 */
export const unmask = (text: string, mapping: Record<string, string>) => {
  let out = text;
  // Sort keys by length (longest first) to prevent partial matches
  const keys = Object.keys(mapping).sort((a, b) => b.length - a.length);
  for (const k of keys) out = out.split(k).join(mapping[k]);
  return out;
};

/** Opaque mask keys produced by {@link maskPlaceholders}, {@link applyGlossaryMask}, {@link maskFunctionKeywords}. */
export const MASK_KEY_RE = /¤(?:PH|GL|FK)\d+¤/g;

export type PlaceholderValidationResult = { ok: true } | { ok: false; message: string };

/** Ensure every expected mask key is present and no unknown keys remain. */
export const validateMaskedTranslation = (
  maskedTranslation: string,
  mapping: Record<string, string>,
): PlaceholderValidationResult => {
  for (const key of Object.keys(mapping)) {
    if (!maskedTranslation.includes(key)) {
      return { ok: false, message: `Missing mask key ${key} in LLM output` };
    }
  }

  const orphans = [...maskedTranslation.matchAll(new RegExp(MASK_KEY_RE.source, 'g'))]
    .map((match) => match[0])
    .filter((key) => !(key in mapping));

  if (orphans.length > 0) {
    return {
      ok: false,
      message: `Unknown or hallucinated mask keys: ${[...new Set(orphans)].join(', ')}`,
    };
  }

  return { ok: true };
};

/** Compare protected token multisets between source and final translation text. */
export const compareProtectedTokens = (
  source: string,
  translation: string,
  game?: GameType | null,
): PlaceholderValidationResult => {
  const srcProtectedTokens = extractProtectedTokens(source, game);
  const dstProtectedTokens = extractProtectedTokens(translation, game);
  if (srcProtectedTokens.join('\u0000') !== dstProtectedTokens.join('\u0000')) {
    return {
      ok: false,
      message: `Protected token mismatch: source=[${srcProtectedTokens.join(', ')}] target=[${dstProtectedTokens.join(', ')}]`,
    };
  }
  return { ok: true };
};

/**
 * Validate LLM output before unmasking and after — catches missing keys and token drift.
 */
export const validateTranslationPlaceholders = (
  source: string,
  maskedTranslation: string,
  placeholderMap: Record<string, string>,
  functionKeywordMap: Record<string, string>,
  game?: GameType | null,
): PlaceholderValidationResult => {
  const combinedMap = { ...placeholderMap, ...functionKeywordMap };
  const maskCheck = validateMaskedTranslation(maskedTranslation, combinedMap);
  if (!maskCheck.ok) return maskCheck;

  const translated = unmask(unmask(maskedTranslation, functionKeywordMap), placeholderMap);
  return compareProtectedTokens(source, translated, game);
};

import type { GameType } from '../types';
import { getFunctionKeywordsForGame } from '../resources/functionKeywords';

// Protects placeholders and tags so the model does not alter them.
// Mask format is ¤PH0¤, ¤GL0¤, and ¤FK0¤ for easy post-replacement.

/**
 * Regular expression that matches the generic placeholder and tag patterns Transynth protects
 * from modification during LLM translation.
 *
 * Covered patterns:
 * - `%d`, `%s`, `%2$s`, etc. — printf-style format specifiers.
 * - `{0}`, `{1}`, … — positional format tokens.
 * - `{name}` — named format tokens.
 * - `[text]` — bracketed tags (e.g. Bethesda subtitle markers).
 * - `<tag>` — XML/HTML-like tags.
 * - `$Identifier` — script-style variable references.
 */
export const PLACEHOLDER_RE = new RegExp([
  String.raw`%\d*\$?[sdif]`,
  String.raw`\{[0-9]+\}`,
  String.raw`\{[A-Za-z_][A-Za-z0-9_]*\}`,
  String.raw`\[[^\]]+\]`,
  String.raw`<[^>]+>`,
  String.raw`\$[A-Za-z_][A-Za-z0-9_]*`
].join('|'), 'g');

const IDENTIFIER_RE = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
const SCRIPT_PUNCTUATION_RE = /::|->|\.[A-Za-z_]|[()[\]=,;+\-/*]/;
const DECLARATION_SIGNAL_RE = /\b(?:Auto|AutoReadOnly|Conditional|Event|EndEvent|EndFunction|Function|Hidden|Property|ScriptName|State)\b/;

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

const overlapsRange = (index: number, token: string, ranges: Array<{ start: number; end: number }>): boolean =>
  ranges.some((range) => index < range.end && index + token.length > range.start);

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
  const externalKeywordMatches = keywordMatches.filter((match) => !overlapsRange(match.index, match.token, protectedRanges));
  if (externalKeywordMatches.length === 0) return [];

  const isScriptLike =
    SCRIPT_PUNCTUATION_RE.test(text)
    || DECLARATION_SIGNAL_RE.test(text)
    || externalKeywordMatches.some((match) => hasCodeLikeKeywordShape(match.token));

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
  const mapping: Record<string,string> = {};
  let i = 0;
  const masked = text.replace(PLACEHOLDER_RE, m => {
    const key = `¤PH${i}¤`;
    mapping[key] = m;
    i++;
    return key;
  });
  return { masked, mapping };
}

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
  const map: Record<string,string> = {};
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
}

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
export const unmask = (text: string, mapping: Record<string,string>) => {
  let out = text;
  // Sort keys by length (longest first) to prevent partial matches
  const keys = Object.keys(mapping).sort((a, b) => b.length - a.length);
  for (const k of keys) out = out.split(k).join(mapping[k]);
  return out;
}

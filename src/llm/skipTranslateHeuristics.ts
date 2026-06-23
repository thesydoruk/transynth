/**
 * Heuristic detection of source strings that should not be translated.
 */

/** Internal mask markers injected by the translation pipeline (¤PH0¤, ¤GL1¤, ¤FK2¤). */
const MARKER_RE = /¤(?:PH|GL|FK)\d+¤/g;

/**
 * Unambiguously-technical tokens that carry no translatable text.
 *
 * Intentionally conservative: only *structured* markup is stripped so that
 * prose accidentally wrapped in angle brackets (e.g. `<User "Bergman" signed in>`)
 * or bracketed stage directions (`[Sarcasm]`, `[Whispering]`) are NOT mistaken
 * for tags — those are left for the LLM to judge.
 *
 * Covered:
 * - `<Alias=…>`, `<Token.Name=…>`, `<Global=…>`, `<font face='…'>` — any tag containing `=`.
 * - `</font>`, `<br>`, `<img …>`, `<mag>`, `<p …>` — known HTML/script tags even without `=`.
 * - `%s`, `%2$d` — printf-style format specifiers.
 * - `{0}`, `{name}` — positional / named format tokens.
 * - `$Identifier` — script-style variable references.
 */
const STRUCTURED_TAG_RE = new RegExp(
  [
    String.raw`<\/?[A-Za-z][^<>]*=[^<>]*>`,
    String.raw`<\/?(?:font|img|p|br|hr|b|i|u|em|strong|mag|dur|alias|token|global)\b[^<>]*>`,
    String.raw`%\d*\$?[sdif]`,
    String.raw`\{[0-9]+\}`,
    String.raw`\{[A-Za-z_][A-Za-z0-9_]*\}`,
    String.raw`\$[A-Za-z_][A-Za-z0-9_]*`,
  ].join('|'),
  'gi',
);

const FORMID_RE = /^[0-9A-Fa-f]{8}$/;

const IDENTIFIER_RE = /^[A-Za-z0-9_\-:.]+$/;

/**
 * "Code-like" shape: a token that reads as an internal identifier rather than a
 * natural word or display name. Signals: an underscore, a digit, an internal
 * camelCase hump (`fooBar`), or a dotted/hyphenated path-like join (`a.b`, `a-b`).
 *
 * Plain capitalised words and names — `Minigun`, `Patrick`, `Caretaker`,
 * `Junkyard` — deliberately do NOT match, so they are never treated as an
 * editor-ID duplicate even when the record's edid happens to equal the name.
 */
const isCodeLikeIdentifier = (token: string): boolean =>
  /_/.test(token) ||
  /\d/.test(token) ||
  /[a-z][A-Z]/.test(token) ||
  /[A-Za-z][.\-][A-Za-z]/.test(token);

/** Record types whose text is a human name/label and must never be treated as a bare code. */
const NAME_BEARING_SIGNATURES = new Set(['NPC_']);

/** Any Unicode letter (Latin, Cyrillic, …) — the signal that text is translatable. */
const LETTER_RE = /\p{L}/u;

const KNOWN_LITERALS = new Set(['none', 'null', 'n/a', 'na', 'true', 'false']);

export type SkipHeuristicHit = {
  reason: string;
  method: 'heuristic';
};

/** Strip internal mask markers before analysing translatable content. */
export const stripPlaceholdersForSkipCheck = (text: string): string =>
  text.replace(MARKER_RE, '').trim();

/** Remove structured markup/format tokens and collapse the leftover whitespace. */
const stripStructuredMarkup = (text: string): string =>
  text.replace(STRUCTURED_TAG_RE, ' ').replace(/\s+/g, ' ').trim();

/**
 * Fast local rules for non-translatable game strings.
 * Returns a reason when the string should be skipped, otherwise null.
 */
export const detectSkipHeuristic = (
  source: string,
  meta?: {
    edid?: string | null;
    path?: string | null;
    signature?: string | null;
  },
): SkipHeuristicHit | null => {
  const trimmed = source.trim();
  if (!trimmed) {
    return { reason: 'Empty source text.', method: 'heuristic' };
  }

  const content = stripPlaceholdersForSkipCheck(trimmed);
  if (!content) {
    return { reason: 'Source contains only placeholders or whitespace.', method: 'heuristic' };
  }

  if (content.length <= 1) {
    return { reason: 'Single-character or empty translatable fragment.', method: 'heuristic' };
  }

  // Strip structured markup (tags, variables, format specifiers) and inspect
  // what is actually left for a human to read.
  const masked = stripStructuredMarkup(content);

  if (!masked) {
    return {
      reason: 'Only markup tokens (tags, variables or format specifiers).',
      method: 'heuristic',
    };
  }

  if (!LETTER_RE.test(masked)) {
    return {
      reason: 'Numbers, symbols, separators or markup only — no translatable letters.',
      method: 'heuristic',
    };
  }

  if (KNOWN_LITERALS.has(masked.toLowerCase())) {
    return { reason: 'Known non-translatable literal token.', method: 'heuristic' };
  }

  if (FORMID_RE.test(masked)) {
    return { reason: 'FormID-like hex token.', method: 'heuristic' };
  }

  // Source duplicates the editor ID — but only treat it as an internal
  // reference when the text actually reads like an identifier. Otherwise a
  // legitimate name/label (e.g. an NPC called "Patrick" whose record edid is
  // also "Patrick", or a weapon "Minigun") would be wrongly skipped.
  const edid = meta?.edid?.trim();
  if (edid && content.toLowerCase() === edid.toLowerCase() && isCodeLikeIdentifier(content)) {
    return { reason: 'Source duplicates editor ID (internal reference).', method: 'heuristic' };
  }

  // Short uppercase code (e.g. stat abbreviations "AGI", "AP"). Skip this rule
  // for name-bearing records so short NPC names/designations ("AJ", "X6") stay
  // translatable.
  const signature = meta?.signature?.trim() ?? null;
  if (
    masked.length <= 3 &&
    IDENTIFIER_RE.test(masked) &&
    masked === masked.toUpperCase() &&
    !(signature && NAME_BEARING_SIGNATURES.has(signature))
  ) {
    return { reason: 'Short uppercase identifier/code.', method: 'heuristic' };
  }

  return null;
};

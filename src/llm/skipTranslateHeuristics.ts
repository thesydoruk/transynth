/**
 * Heuristic detection of source strings that should not be translated.
 */

const PLACEHOLDER_RE = /¤(?:PH|GL|FK)\d+¤/g;

const NUMERIC_ONLY_RE = /^[\d\s.,:;+\-/()%°×*#]+$/;

const FORMID_RE = /^[0-9A-Fa-f]{8}$/;

const SYMBOLS_ONLY_RE = /^[<>\[\]{}|\\^~`'"!?@&*_=]+$/;

const IDENTIFIER_RE = /^[A-Za-z0-9_\-:.]+$/;

const KNOWN_LITERALS = new Set([
  'none',
  'null',
  'n/a',
  'na',
  '---',
  '====',
  '....',
  '...',
  'true',
  'false',
]);

export type SkipHeuristicHit = {
  reason: string;
  method: 'heuristic';
};

/** Strip game placeholders before analysing translatable content. */
export const stripPlaceholdersForSkipCheck = (text: string): string =>
  text.replace(PLACEHOLDER_RE, '').trim();

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

  if (KNOWN_LITERALS.has(content.toLowerCase())) {
    return { reason: 'Known non-translatable literal token.', method: 'heuristic' };
  }

  if (NUMERIC_ONLY_RE.test(content)) {
    return { reason: 'Numeric or punctuation-only value.', method: 'heuristic' };
  }

  if (SYMBOLS_ONLY_RE.test(content)) {
    return { reason: 'Symbols-only string.', method: 'heuristic' };
  }

  if (FORMID_RE.test(content)) {
    return { reason: 'FormID-like hex token.', method: 'heuristic' };
  }

  const edid = meta?.edid?.trim();
  if (edid && content.toLowerCase() === edid.toLowerCase()) {
    return { reason: 'Source duplicates editor ID (internal reference).', method: 'heuristic' };
  }

  if (content.length <= 3 && IDENTIFIER_RE.test(content) && content === content.toUpperCase()) {
    return { reason: 'Short uppercase identifier/code.', method: 'heuristic' };
  }

  if (/^%[\d+\-]*[sdif]$/.test(content) || /^%\(\w+\)[sdif]$/.test(content)) {
    return { reason: 'Printf-style format token only.', method: 'heuristic' };
  }

  return null;
};

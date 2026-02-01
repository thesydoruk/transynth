// Simple normalization for hashing/alignment: lowercasing, stripping tags/placeholders/numbers and collapsing whitespace.
import { PLACEHOLDER_RE } from './placeholders.js';

export const normalizeForHash = (s: string): string => {
  let t = s || '';
  t = t.replace(PLACEHOLDER_RE, '¤PH¤');
  t = t.replace(/\d+/g, '¤NUM¤');
  t = t.replace(/\s+/g, ' ');
  t = t.trim().toLowerCase();
  return t;
}

/**
 * Extra-aggressive normalization: strip all punctuation on top of normalizeForHash.
 * Used for punctuation-insensitive TM matching.
 */
export const normalizeNoPunct = (s: string): string => {
  let t = normalizeForHash(s);
  t = t.replace(/[^\w¤ ]/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

/**
 * Split a source string into translatable phrase segments.
 *
 * Uses sentence-ending punctuation (. ! ? ; \n) and colons as delimiters.
 * Only returns segments with at least 3 non-whitespace characters — shorter
 * fragments are too noisy for TM lookup. Each returned segment is trimmed
 * but NOT normalised (caller should normalise if needed).
 *
 * @param text  Raw source text to segment
 * @returns     Array of phrase segments (minimum 2 segments required; if text
 *              cannot be split, returns empty array)
 */
export const segmentPhrases = (text: string): string[] => {
  /* Split on sentence-ending punctuation, semicolons, colons, and newlines */
  const parts = text.split(/(?<=[.!?;:\n])\s*/);
  const segments = parts
    .map((p) => p.trim())
    .filter((p) => p.replace(/\s/g, '').length >= 3);

  /* Only useful if the text actually splits into multiple parts */
  return segments.length >= 2 ? segments : [];
}

// ── Numeric-invariant matching utilities ───────────────────────────────────────

/** Regex matching integers and decimal numbers (e.g. "25", "3.14", "0.5"). */
const NUMBER_RE = /\d+(?:\.\d+)?/g;

/**
 * Extract all numbers from a string in order of appearance.
 * Preserves original formatting (leading zeros, decimals).
 *
 * @param text  Raw text to scan
 * @returns     Ordered array of number strings, e.g. ["25", "3.14"]
 */
export const extractNumbers = (text: string): string[] =>
  text.match(NUMBER_RE) ?? [];

/**
 * Transplant numbers from a new source into an existing translation.
 *
 * Given a matched translation where the only difference between old and new
 * source is the numeric values, replaces each old number in the translation
 * with the corresponding new number (matched by position).
 *
 * @param translation  The matched translation text containing old numbers
 * @param oldNumbers   Numbers extracted from the matched source (positional)
 * @param newNumbers   Numbers extracted from the new source (positional)
 * @returns            Translation with transplanted numbers, or null if
 *                     the transplant is impossible (count mismatch, number
 *                     not found in translation)
 */
export const transplantNumbers = (
  translation: string,
  oldNumbers: string[],
  newNumbers: string[],
): string | null => {
  /* Number counts must match for a safe 1:1 replacement. */
  if (oldNumbers.length !== newNumbers.length) return null;
  if (oldNumbers.length === 0) return translation;

  /*
   * Two-pass replacement to avoid substring collisions (e.g. replacing "100"
   * with "150" then "5" with "8" would hit the "5" inside "150").
   * Pass 1: replace each old number with a unique placeholder.
   * Pass 2: replace each placeholder with the corresponding new number.
   */
  let result = translation;
  for (let i = 0; i < oldNumbers.length; i++) {
    if (oldNumbers[i] === newNumbers[i]) continue;
    const idx = result.indexOf(oldNumbers[i]);
    if (idx === -1) return null;
    result = result.slice(0, idx) + `\x00NUM${i}\x00` + result.slice(idx + oldNumbers[i].length);
  }
  for (let i = 0; i < newNumbers.length; i++) {
    result = result.replace(`\x00NUM${i}\x00`, newNumbers[i]);
  }
  return result;
};

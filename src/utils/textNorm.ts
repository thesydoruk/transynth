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

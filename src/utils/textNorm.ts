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

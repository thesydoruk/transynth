// Simple normalization for hashing/alignment: lowercasing, stripping tags/placeholders/numbers and collapsing whitespace.
import { restoreDiscoMarkupShape } from '../formats/po/discoLockitMarkup';
import { PLACEHOLDER_RE } from './placeholders';

export const normalizeForHash = (s: string): string => {
  let t = s || '';
  t = t.replace(PLACEHOLDER_RE, '¤PH¤');
  t = t.replace(/\d+/g, '¤NUM¤');
  t = t.replace(/\s+/g, ' ');
  t = t.trim().toLowerCase();
  return t;
};

/**
 * Extra-aggressive normalization: strip all punctuation on top of normalizeForHash.
 * Used for punctuation-insensitive TM matching.
 */
/** Replace typographic dashes (en/em) with ASCII hyphen in LLM auto-translations. */
export const normalizeAutoTranslationDashes = (text: string): string =>
  text.replace(/\u2013|\u2014/g, '-');

/** Fold Ukrainian/typographic guillemets to ASCII quotes. Never the reverse. */
export const normalizeAutoTranslationQuotes = (text: string): string => text.replace(/[«»]/g, '"');

const LETTER_RE = /\p{L}/u;

/**
 * True when the source has at least one letter and every letter is uppercase
 * (digits/punctuation/whitespace ignored). Used to force matching ALL CAPS in
 * auto-translations.
 */
export const isSourceAllCaps = (source: string): boolean => {
  const letters = source.match(/\p{L}/gu);
  if (!letters || letters.length === 0) return false;
  return letters.every((ch) => ch === ch.toLocaleUpperCase('en-US'));
};

/**
 * If source is entirely ALL CAPS, uppercase the translation (Ukrainian locale
 * so і/ї/є/ґ map correctly). Otherwise return translation unchanged.
 */
export const matchSourceCapitalization = (source: string, translation: string): string => {
  if (!isSourceAllCaps(source)) return translation;
  return translation.toLocaleUpperCase('uk-UA');
};

/** Dash + quote + capitalization post-process for LLM / auto translations. */
export const normalizeAutoTranslation = (source: string, translation: string): string =>
  matchSourceCapitalization(source, restoreDiscoMarkupShape(source, translation));

export const normalizeNoPunct = (s: string): string => {
  let t = normalizeForHash(s);
  t = t.replace(/[^\w¤ ]/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
};

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
export const extractNumbers = (text: string): string[] => text.match(NUMBER_RE) ?? [];

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

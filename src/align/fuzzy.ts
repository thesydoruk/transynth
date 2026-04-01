/**
 * Thin wrapper around the `fuzzball` library's `ratio` function.
 * Returns a 0–100 similarity score compatible with RapidFuzz's `ratio` semantics.
 */
import { ratio } from 'fuzzball';

/**
 * Compute fuzzy similarity between two strings.
 *
 * Delegates to `fuzzball.ratio`, which implements the same normalised
 * Levenshtein-based ratio as Python's `rapidfuzz.fuzz.ratio`.
 *
 * @param a - First string.
 * @param b - Second string.
 * @returns Integer in the range `0..100`, where `100` means identical.
 */
export const fuzzyScore = (a: string, b: string): number => {
  return ratio(a ?? '', b ?? '');
}
import { extractNumbers, transplantNumbers } from '../../utils/textNorm';

/**
 * Adapt a TM match translation from the matched source string to the target
 * source string. Exact source copies pass through; numeric-only differences
 * transplant numbers into the translation. Returns null when adaptation is
 * unsafe (e.g. number count mismatch or numbers missing from the translation).
 */
export const adaptTmTranslation = (
  translation: string,
  matchSource: string,
  targetSource: string,
): string | null => {
  if (matchSource === targetSource) return translation;
  return transplantNumbers(translation, extractNumbers(matchSource), extractNumbers(targetSource));
};

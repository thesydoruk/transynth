import { extractNumbers, normalizeAutoTranslation, transplantNumbers } from '../../utils/textNorm';

/**
 * Adapt a TM match translation from the matched source string to the target
 * source string. Exact source copies pass through; numeric-only differences
 * transplant numbers into the translation. Returns null when adaptation is
 * unsafe (e.g. number count mismatch or numbers missing from the translation).
 *
 * Successful adaptations get the same dash + ALL CAPS post-process as LLM
 * auto-translations, keyed off the target source string.
 */
export const adaptTmTranslation = (
  translation: string,
  matchSource: string,
  targetSource: string,
): string | null => {
  const adapted =
    matchSource === targetSource
      ? translation
      : transplantNumbers(translation, extractNumbers(matchSource), extractNumbers(targetSource));
  if (adapted === null) return null;
  return normalizeAutoTranslation(targetSource, adapted);
};

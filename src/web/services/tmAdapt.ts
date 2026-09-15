import { extractNumbers, normalizeAutoTranslation, transplantNumbers } from '../../utils/textNorm';
import type { GameId } from '../../types';

/**
 * Adapt a TM match translation from the matched source string to the target
 * source string. Exact source copies pass through; numeric-only differences
 * transplant numbers into the translation. Returns null when adaptation is
 * unsafe (e.g. number count mismatch or numbers missing from the translation).
 *
 * Successful adaptations get the same markup + ALL CAPS post-process as LLM
 * auto-translations, keyed off the target source string. `game` is the game
 * the translation is being written *into*: a match may come from another mod,
 * but the punctuation rules that apply are the destination's.
 */
export const adaptTmTranslation = (
  translation: string,
  matchSource: string,
  targetSource: string,
  game: GameId | null | undefined,
): string | null => {
  const adapted =
    matchSource === targetSource
      ? translation
      : transplantNumbers(translation, extractNumbers(matchSource), extractNumbers(targetSource));
  if (adapted === null) return null;
  return normalizeAutoTranslation(targetSource, adapted, game);
};

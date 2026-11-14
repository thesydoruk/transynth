import {
  extractNumbers,
  matchSourceCapitalization,
  normalizeAutoTranslationQuotes,
  transplantNumbers,
} from '../../utils/textNorm';
import { PLACEHOLDER_RE } from '../../utils/placeholders';

/** Placeholders and tags in order, without the paragraph-break runs the regex also masks. */
const placeholdersOf = (text: string): string[] =>
  (text.match(PLACEHOLDER_RE) ?? []).filter((token) => /\S/.test(token));

const digitsBlind = (token: string): string => token.replace(/\d+/g, '#');

/**
 * TM matches on normalized text, where every placeholder reads the same, so a
 * match can carry another line's keys: MCM help `${helpClickAction}` written
 * where the target has `${Item_sorter_help}`. Swap each placeholder that
 * differs between the two sources (positionally); give up when the counts
 * differ or the translation lacks one of them. Placeholders that differ only by
 * digits were already handled by the number transplant.
 */
const transplantPlaceholders = (
  translation: string,
  matchSource: string,
  targetSource: string,
): string | null => {
  const from = placeholdersOf(matchSource);
  const to = placeholdersOf(targetSource);
  if (from.length !== to.length) return null;
  let result = translation;
  const swaps: string[] = [];
  for (let i = 0; i < from.length; i++) {
    if (from[i] === to[i] || digitsBlind(from[i]!) === digitsBlind(to[i]!)) continue;
    const idx = result.indexOf(from[i]!);
    if (idx === -1) return null;
    result = `${result.slice(0, idx)}\x00PH${swaps.length}\x00${result.slice(idx + from[i]!.length)}`;
    swaps.push(to[i]!);
  }
  swaps.forEach((token, n) => {
    result = result.replace(`\x00PH${n}\x00`, token);
  });
  return result;
};

/**
 * Adapt a TM match translation from the matched source string to the target
 * source string. Exact source copies pass through; numeric-only differences
 * transplant numbers into the translation, and differing placeholders are
 * swapped for the target's. Returns null when adaptation is unsafe (e.g.
 * number or placeholder count mismatch, or one missing from the translation).
 *
 * A match is a stored translation, most often a reviewed one, so it is copied
 * the way a save would store it: guillemets fold to ASCII quotes (the editor
 * rule) and an ALL CAPS source keeps its translation in capitals. The markup
 * step for LLM drafts must not run here: for a Creation Engine game it folds an
 * em dash to a hyphen, and a reviewer put that dash there on purpose —
 * re-imported mods lost theirs that way while still reading `reviewed`.
 */
const storeAsSaved = (targetSource: string, translation: string): string =>
  matchSourceCapitalization(targetSource, normalizeAutoTranslationQuotes(translation));

export const adaptTmTranslation = (
  translation: string,
  matchSource: string,
  targetSource: string,
): string | null => {
  if (matchSource === targetSource) return storeAsSaved(targetSource, translation);
  const numbered = transplantNumbers(
    translation,
    extractNumbers(matchSource),
    extractNumbers(targetSource),
  );
  if (numbered === null) return null;
  const adapted = transplantPlaceholders(numbered, matchSource, targetSource);
  if (adapted === null) return null;
  return storeAsSaved(targetSource, adapted);
};

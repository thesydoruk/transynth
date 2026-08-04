/**
 * Letters a language needs a font to draw.
 *
 * Used to tell whether a font family can render a language at all, and to widen the
 * character lists FontConfig uses to filter what a player may type.
 */

const UKRAINIAN_LOWER = 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя';

const ALPHABETS: Record<string, string> = {
  uk: `${UKRAINIAN_LOWER}${UKRAINIAN_LOWER.toUpperCase()}`,
};

/** Punctuation the language's spelling needs beyond its letters. */
const EXTRA_INPUT_CHARS: Record<string, string> = { uk: '’' };

const baseTag = (lang: string): string => lang.trim().toLowerCase().split(/[-_]/)[0]!;

/**
 * Letters of a language, both cases, or an empty string when the language is unknown.
 *
 * Letters only: punctuation is left out so a font is not judged unusable over an
 * apostrophe.
 *
 * @param lang - Language tag; the region is ignored, so `uk-UA` matches `uk`.
 */
export const languageAlphabet = (lang: string): string => ALPHABETS[baseTag(lang)] ?? '';

/** Characters a player must be allowed to type in this language. */
export const languageInputChars = (lang: string): string => {
  const alphabet = languageAlphabet(lang);
  return alphabet ? `${alphabet}${EXTRA_INPUT_CHARS[baseTag(lang)] ?? ''}` : '';
};

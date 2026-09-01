/**
 * Restore ZA/UM lockit asterisk-censorship for translate + TTS.
 *
 * DialoguesLockitEnglish.po (~73k lines) censors one slur family in ~89 lines
 * (`f****t`, `Pissf****t` on the jacket). Other swearing is already full-word.
 * Italics `*belong*` are not tokens and stay untouched.
 */

const CENSOR_MAP: ReadonlyMap<string, string> = new Map([
  ['pissf****ts', 'pissfaggots'],
  ['pissf****t', 'pissfaggot'],
  ['f******t', 'faggot'],
  ['f****ted', 'faggoted'],
  ['f****ts', 'faggots'],
  ['f****t', 'faggot'],
]);

/** Letter + 2+ stars + letters: `f****t`, not `*italic*`. */
const CENSOR_TOKEN_RE = /[A-Za-z]+(?:\*+[A-Za-z]+)+/g;

const applySampleCase = (sample: string, replacement: string): string => {
  const letters = sample.replace(/[^A-Za-z]/g, '');
  if (letters.length > 0 && letters === letters.toUpperCase()) return replacement.toUpperCase();
  const first = sample[0];
  if (first && first === first.toUpperCase()) {
    return `${replacement[0]!.toUpperCase()}${replacement.slice(1)}`;
  }
  return replacement;
};

/** Replace known `f****t`-family tokens. Idempotent; unknown star-tokens stay. */
export const restoreDiscoCensoredSpeech = (text: string): string => {
  if (!text.includes('*')) return text;
  return text.replace(CENSOR_TOKEN_RE, (token) => {
    const restored = CENSOR_MAP.get(token.toLowerCase());
    return restored ? applySampleCase(token, restored) : token;
  });
};

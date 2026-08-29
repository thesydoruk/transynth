const VOWEL_GROUPS_RE = /[aeiouy]+/g;

/** Count vowel groups in one English word (silent trailing e dropped). */
const countWordSyllables = (word: string): number => {
  const stem = word.replace(/e$/i, '');
  if (!stem) return 1;
  const groups = stem.match(VOWEL_GROUPS_RE);
  return Math.max(1, groups?.length ?? 0);
};

/**
 * Approximate English syllable count from spoken transcript text.
 * Stage directions should already be stripped by the caller.
 */
export const countEnglishSyllables = (text: string): number => {
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let total = 0;
  for (const word of words) {
    total += countWordSyllables(word);
  }
  return total;
};

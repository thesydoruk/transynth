import { countEnglishSyllables } from '../syllables';

describe('countEnglishSyllables', () => {
  it('counts vowel groups and treats a silent trailing e as one syllable less', () => {
    expect(countEnglishSyllables('go')).toBe(1);
    expect(countEnglishSyllables('the')).toBe(1);
    expect(countEnglishSyllables('robot')).toBe(2);
    expect(countEnglishSyllables('banana')).toBe(3);
  });

  it('sums words and ignores punctuation', () => {
    expect(countEnglishSyllables('Hello, there!')).toBe(3);
    expect(countEnglishSyllables('go go go go go')).toBe(5);
  });

  it('returns 0 for empty or non-letter input', () => {
    expect(countEnglishSyllables('')).toBe(0);
    expect(countEnglishSyllables('   …  ')).toBe(0);
  });
});

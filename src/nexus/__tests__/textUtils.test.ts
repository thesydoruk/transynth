import { describe, expect, it } from '@jest/globals';
import {
  extractImportantTokens,
  isLikelyTranslationCategory,
  normalizeLanguage,
  uniqueStrings,
} from '../client/textUtils';

describe('nexus textUtils', () => {
  it('dedupes strings case-insensitively and keeps the first spelling', () => {
    expect(uniqueStrings([' Fallout ', 'fallout', 'Skyrim', ''])).toEqual([' Fallout ', 'Skyrim']);
  });

  it('normalizes translation language codes', () => {
    expect(normalizeLanguage(' UK ')).toBe('uk');
    expect(normalizeLanguage('')).toBeNull();
    expect(normalizeLanguage(undefined)).toBeNull();
  });

  it('drops stop words from title tokens', () => {
    expect(extractImportantTokens('The Unofficial Fallout 4 Patch')).toEqual([
      'unofficial',
      'fallout',
      'patch',
    ]);
  });

  it('recognizes translation-style Nexus categories', () => {
    expect(isLikelyTranslationCategory('Translations')).toBe(true);
    expect(isLikelyTranslationCategory('Weapons')).toBe(false);
    expect(isLikelyTranslationCategory(null)).toBe(false);
  });
});

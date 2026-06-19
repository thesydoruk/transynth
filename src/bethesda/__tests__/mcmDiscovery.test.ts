import { describe, it, expect } from '@jest/globals';
import { mcmTranslationMatchesMod, resolveMcmLocaleKey } from '../parsers/mcmDiscovery';

describe('mcmTranslationMatchesMod', () => {
  it('matches MCM Helper file names', () => {
    expect(mcmTranslationMatchesMod('Dank_LEO_en.txt', 'Dank_LEO')).toBe(true);
    expect(mcmTranslationMatchesMod('Dank_LEO_ptbr.txt', 'Dank_LEO')).toBe(true);
    expect(mcmTranslationMatchesMod('OtherMod_en.txt', 'Dank_LEO')).toBe(false);
  });
});

describe('resolveMcmLocaleKey', () => {
  it('resolves short and extended Fallout 4 locale codes', () => {
    const locales = new Map([
      ['en', new Map([['$k', 'English']])],
      ['cn', new Map([['$k', 'Chinese']])],
      ['ptbr', new Map([['$k', 'Portuguese']])],
      ['esmx', new Map([['$k', 'Spanish MX']])],
    ]);

    expect(resolveMcmLocaleKey(locales, 'en')?.resolvedKey).toBe('en');
    expect(resolveMcmLocaleKey(locales, 'english')?.resolvedKey).toBe('en');
    expect(resolveMcmLocaleKey(locales, 'zh')?.resolvedKey).toBe('cn');
    expect(resolveMcmLocaleKey(locales, 'pt')?.resolvedKey).toBe('ptbr');
    expect(resolveMcmLocaleKey(locales, 'esmx')?.resolvedKey).toBe('esmx');
  });
});

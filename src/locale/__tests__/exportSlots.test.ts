import { describe, expect, it } from '@jest/globals';
import { exportLocaleSlots, isOfficialBethesdaLocale } from '../exportSlots';

describe('exportLocaleSlots', () => {
  it('maps unofficial FO4 targets to en and ru install slots', () => {
    expect(exportLocaleSlots('uk', 'fo4')).toEqual(['en', 'ru']);
    expect(exportLocaleSlots('uk', 'fo76')).toEqual(['en', 'ru']);
  });

  it('keeps official FO4 locales as a single slot', () => {
    expect(exportLocaleSlots('de', 'fo4')).toEqual(['de']);
    expect(exportLocaleSlots('ru', 'fo4')).toEqual(['ru']);
  });

  it('uses target lang as-is for other games', () => {
    expect(exportLocaleSlots('uk', 'sse')).toEqual(['uk']);
  });

  it('classifies FO4 official locales', () => {
    expect(isOfficialBethesdaLocale('uk', 'fo4')).toBe(false);
    expect(isOfficialBethesdaLocale('en', 'fo4')).toBe(true);
    expect(isOfficialBethesdaLocale('ru', 'fo4')).toBe(true);
  });
});

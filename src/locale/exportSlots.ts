import type { GameType } from '../types';

/** Locale suffixes shipped in official Fallout 4 / 76 string tables and Interface files. */
const FO4_OFFICIAL_LOCALES = new Set([
  'en',
  'ru',
  'de',
  'fr',
  'es',
  'esmx',
  'it',
  'pl',
  'ptbr',
  'ja',
  'cn',
]);

export const isOfficialBethesdaLocale = (locale: string, game: GameType): boolean => {
  const lang = locale.trim().toLowerCase();
  if (game === 'fo4' || game === 'fo76') return FO4_OFFICIAL_LOCALES.has(lang);
  return true;
};

/**
 * Locale file suffixes to write when exporting translations for installation.
 *
 * Unofficial targets (e.g. Ukrainian on FO4) ship in both `en` and `ru` slots
 * so the patch replaces the two locales players typically switch between.
 */
export const exportLocaleSlots = (targetLang: string, game: GameType): string[] => {
  const lang = targetLang.trim().toLowerCase();
  if ((game === 'fo4' || game === 'fo76') && !isOfficialBethesdaLocale(lang, game)) {
    return ['en', 'ru'];
  }
  return [lang];
};

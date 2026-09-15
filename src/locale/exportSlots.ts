import { creationEngineTitle } from '../games/creation-engine/registry';
import type { GameId } from '../types';

/**
 * Locale file suffixes to write when exporting translations for installation.
 *
 * A game ships string tables and Interface files only for the locales it was
 * released in. Exporting an unofficial target (Ukrainian on Fallout 4) into a
 * suffix the game never loads would produce files the engine ignores, so those
 * go into the `en` and `ru` slots — the two locales players switch between.
 */
export const isOfficialBethesdaLocale = (locale: string, game: GameId): boolean => {
  const official = creationEngineTitle(game).strings.officialLocales;
  return official === null || official.has(locale.trim().toLowerCase());
};

export const exportLocaleSlots = (targetLang: string, game: GameId): string[] => {
  const lang = targetLang.trim().toLowerCase();
  return isOfficialBethesdaLocale(lang, game) ? [lang] : ['en', 'ru'];
};

import { creationEngineTitle } from '../registry';
import type { CreationEngineTitle } from '../title';
import type { GameId } from '../../../types';

export type InterfaceFonts = NonNullable<CreationEngineTitle['interfaceFonts']>;

/** Locales an unofficial target replaces when the title does not say otherwise. */
const DEFAULT_UNOFFICIAL_SLOTS: readonly string[] = ['en', 'ru'];

/**
 * Locale file suffixes to write when exporting translations for installation.
 *
 * A game ships string tables and Interface files only for the locales it was
 * released in. Exporting an unofficial target (Ukrainian on Fallout 4) into a
 * suffix the game never loads would produce files the engine ignores, so those
 * go into the title's unofficial slots — the locales players switch between:
 * `en` and `ru` on Fallout 4, `en` alone on Starfield, which has no Russian.
 */
export const isOfficialBethesdaLocale = (locale: string, game: GameId): boolean => {
  const official = creationEngineTitle(game).strings.officialLocales;
  return official === null || official.has(locale.trim().toLowerCase());
};

export const exportLocaleSlots = (targetLang: string, game: GameId): string[] => {
  const lang = targetLang.trim().toLowerCase();
  if (isOfficialBethesdaLocale(lang, game)) return [lang];
  return [...(creationEngineTitle(game).strings.unofficialSlots ?? DEFAULT_UNOFFICIAL_SLOTS)];
};

/**
 * Where the title keeps its interface fonts and who lends them letters, or `null`
 * for Fallout 4's layout (`CreationEngineTitle.interfaceFonts`).
 */
export const interfaceFontsForGame = (game: GameId): InterfaceFonts | null =>
  creationEngineTitle(game).interfaceFonts ?? null;

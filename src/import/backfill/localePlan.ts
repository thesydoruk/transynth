/**
 * Reproduce the locale decisions of the original import for a backfill run.
 *
 * Mirrors `prepareEspImportContext`: which STRINGS locales the mod ships, and
 * whether the import ran in single-locale or all-localizations mode. Getting
 * this wrong would write the new records under different languages than the
 * ones the mod already has.
 */
import type { EspReader } from '../../formats/esp';
import type { GameType } from '../../types';
import { discoverArchiveCandidatesForPlugin } from '../mod/discovery';
import { discoverLocaleSources, localeSourcesByLocale } from '../mod/localeSources';
import type { LocaleStringsSource } from '../mod/localeSources';
import {
  MOD_IMPORT_DEFAULT_SOURCE_LOCALE,
  isImportAllLocalesRequest,
  resolveModStringsLang,
  resolveSingleImportLocale,
} from '../mod/localeHelpers';

export type BackfillLocalePlan = {
  localeSources: LocaleStringsSource[];
  /** Locales written into `strings`; empty when the plugin has no STRINGS files. */
  locales: string[];
  singleLocaleMode: boolean;
  /** Language tag for inline plugin text, used when no locale files exist. */
  pluginStringLang: string;
};

export const resolveBackfillLocalePlan = (
  esp: EspReader,
  espPath: string,
  game: GameType,
  srcLang: string,
): BackfillLocalePlan => {
  const pluginStringLang = resolveModStringsLang(
    isImportAllLocalesRequest(srcLang) ? MOD_IMPORT_DEFAULT_SOURCE_LOCALE : srcLang,
  );

  const localeSources = esp.info.isLocalized
    ? discoverLocaleSources(espPath, game, discoverArchiveCandidatesForPlugin(espPath))
    : [];

  const catalog = localeSourcesByLocale(localeSources);
  const selectedLocale =
    localeSources.length > 0
      ? resolveSingleImportLocale(
          new Map([...catalog.keys()].map((locale) => [locale, true])),
          srcLang,
        )
      : null;
  const singleLocaleMode = selectedLocale != null;

  const locales = [...catalog.keys()]
    .filter((locale) => !singleLocaleMode || locale === selectedLocale)
    .sort();

  return { localeSources, locales, singleLocaleMode, pluginStringLang };
};

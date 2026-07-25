import fs from 'node:fs';
import { EspReader } from '../../../formats/esp';
import { resolveMcmLocaleKey, resolveModDirectoryFromPath } from '../../../formats/mcm';
import {
  discoverLocaleSources,
  localeSourcesByLocale,
  loadLocaleStringsByType,
} from '../modImportLocaleStream';
import type { CsvRow, GameType } from '../../../types';
import { materializeImportCsvRows, toApplyRows } from './csvHelpers';
import { MOD_IMPORT_DEFAULT_SOURCE_LOCALE, resolveAvailableLocale } from './localeHelpers';
import { collectMcmLocalesForMod, buildMcmCsvRows } from './mcmLocales';
import { collectPexStringsSync, buildPexCsvRows } from './pexStrings';
import { discoverArchiveCandidatesForPlugin, isPluginPath } from './discovery';
import type { ModImportApplyRow, ModImportJob } from './types';

export const extractModImportApplyRows = (
  job: ModImportJob,
  importedLang: string,
): ModImportApplyRow[] => {
  const anchorPath = job.esp_path;
  if (!anchorPath || !fs.existsSync(anchorPath)) {
    throw new Error('Import file not found on disk');
  }

  const modDir = resolveModDirectoryFromPath(anchorPath);
  const collected: CsvRow[] = [];

  if (isPluginPath(anchorPath)) {
    const game: GameType = (job.game as GameType) ?? 'fo4';
    const esp = new EspReader(anchorPath, game);
    const espRows = esp.extractStrings();

    if (esp.info.isLocalized) {
      const localeSources = discoverLocaleSources(
        anchorPath,
        game,
        discoverArchiveCandidatesForPlugin(anchorPath),
      );
      const byLocale = localeSourcesByLocale(localeSources);
      const resolved = resolveAvailableLocale(byLocale, importedLang);
      if (!resolved) {
        const available = localeSources
          .map((s) => s.locale)
          .sort()
          .join(', ');
        throw new Error(
          available
            ? `Localized import does not contain locale "${importedLang}". Available locales: ${available}`
            : 'Localized import does not contain any STRINGS locales',
        );
      }
      collected.push(
        ...materializeImportCsvRows(espRows, loadLocaleStringsByType(resolved.value), game),
      );
    } else {
      collected.push(...materializeImportCsvRows(espRows, null, game));
    }

    const pexMap = collectPexStringsSync(anchorPath, (job.game as GameType) ?? 'fo4');
    if (pexMap.size > 0) {
      collected.push(...buildPexCsvRows(pexMap, new Map()).map((row) => row.csvRow));
    }
  }

  const mcmLocales = collectMcmLocalesForMod(modDir, anchorPath);
  const resolvedMcm =
    resolveMcmLocaleKey(mcmLocales, importedLang) ??
    (isPluginPath(anchorPath)
      ? resolveMcmLocaleKey(mcmLocales, MOD_IMPORT_DEFAULT_SOURCE_LOCALE)
      : null);
  if (resolvedMcm) {
    collected.push(...buildMcmCsvRows(resolvedMcm.value));
  } else if (!isPluginPath(anchorPath)) {
    const available = [...mcmLocales.keys()].sort().join(', ');
    throw new Error(
      available
        ? `MCM translation patch does not contain locale "${importedLang}". Available locales: ${available}`
        : 'MCM translation patch does not contain any translation files',
    );
  }

  if (collected.length === 0) {
    throw new Error(`Import job has no translatable rows for lang "${importedLang}"`);
  }

  return toApplyRows(collected);
};

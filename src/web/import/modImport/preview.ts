import fs from 'node:fs';
import { EspReader } from '../../../formats/esp';
import { resolveMcmLocaleKey, resolveModDirectoryFromPath } from '../../../formats/mcm';
import {
  discoverLocaleSources,
  localeSourcesByLocale,
  loadLocaleStrings,
} from '../modImportLocaleStream';
import type { GameType } from '../../../types';
import { materializeImportCsvRows } from './csvHelpers';
import { MOD_IMPORT_DEFAULT_SOURCE_LOCALE, resolveAvailableLocale } from './localeHelpers';
import { collectMcmLocalesForMod } from './mcmLocales';
import { discoverArchiveCandidatesForPlugin, isPluginPath } from './discovery';
import type { ModImportJob, ModPreviewRow } from './types';

export const previewModRecords = (
  job: ModImportJob,
  ba2Candidates: string[] = [],
): {
  rows: ModPreviewRow[];
  locales: string[];
  isLocalized: boolean;
} => {
  const anchorPath = job.esp_path;
  if (!anchorPath || !fs.existsSync(anchorPath)) throw new Error('Import file not found on disk');

  if (!isPluginPath(anchorPath)) {
    const modDir = resolveModDirectoryFromPath(anchorPath);
    const mcmLocales = collectMcmLocalesForMod(modDir, anchorPath);
    const resolved =
      resolveMcmLocaleKey(mcmLocales, MOD_IMPORT_DEFAULT_SOURCE_LOCALE) ??
      (mcmLocales.size > 0
        ? {
            resolvedKey: [...mcmLocales.keys()][0]!,
            value: mcmLocales.get([...mcmLocales.keys()][0]!)!,
          }
        : null);

    const mcmMap = resolved?.value ?? new Map<string, string>();
    const rows: ModPreviewRow[] = [...mcmMap.entries()].slice(0, 200).map(([key, text]) => ({
      formId: '',
      signature: 'MCM',
      edid: '',
      path: `MCM\\${key}`,
      source: text,
    }));

    return {
      rows,
      locales: [...mcmLocales.keys()],
      isLocalized: false,
    };
  }

  const game: GameType = (job.game as GameType) ?? 'fo4';
  const esp = new EspReader(anchorPath, game);
  const espRows = esp.extractStrings();

  const localeSources = discoverLocaleSources(
    anchorPath,
    game,
    ba2Candidates.length > 0 ? ba2Candidates : discoverArchiveCandidatesForPlugin(anchorPath),
  );

  const previewLocale =
    resolveAvailableLocale(localeSourcesByLocale(localeSources), MOD_IMPORT_DEFAULT_SOURCE_LOCALE)
      ?.resolvedKey ??
    localeSources[0]?.locale ??
    null;
  const stringsMap = previewLocale
    ? loadLocaleStrings(localeSourcesByLocale(localeSources).get(previewLocale)!)
    : null;
  const csvRows = materializeImportCsvRows(espRows, stringsMap);

  const rows: ModPreviewRow[] = csvRows.slice(0, 200).map((r) => ({
    formId: r.FormID,
    signature: r.Signature,
    edid: r.EDID ?? '',
    path: r.Path,
    source: r.Source,
  }));

  return {
    rows,
    locales: localeSources.map((s) => s.locale),
    isLocalized: esp.info.isLocalized,
  };
};

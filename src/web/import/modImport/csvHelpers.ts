import type { EspStringRow } from '../../../formats/esp';
import type { CsvRow, GameType } from '../../../types';
import {
  discoverLocaleSources,
  generateImportCsvRows,
  loadLocaleStringsByType,
  resolveEnglishLocaleSource,
  type LocaleStringsMaps,
} from '../modImportLocaleStream';
import type { ModImportApplyRow } from './types';

const resolveEnglishLocaleMaps = (
  localeSources: ReturnType<typeof discoverLocaleSources>,
): LocaleStringsMaps | undefined => {
  const source = resolveEnglishLocaleSource(localeSources);
  return source ? loadLocaleStringsByType(source) : undefined;
};

const materializeImportCsvRows = (
  espRows: EspStringRow[],
  stringsMaps: LocaleStringsMaps | null,
  game: GameType = 'fo4',
): CsvRow[] => [...generateImportCsvRows(espRows, stringsMaps, game)];

/**
 * Convert generic CSV-style rows into the canonical imported-row shape used by
 * the translation-apply matcher.
 */
const toApplyRows = (rows: CsvRow[]): ModImportApplyRow[] =>
  rows.map((row) => ({
    formid_hex: row.FormID ?? '',
    path: row.Path,
    path_simplified: row.PathSimplified ?? row.Path.replace(/\[\d+\]/g, ''),
    signature: row.Signature ?? null,
    edid: row.EDID ?? null,
    text_raw: row.Source,
  }));

export { resolveEnglishLocaleMaps, materializeImportCsvRows, toApplyRows };

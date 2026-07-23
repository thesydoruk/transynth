import type { EspStringRow } from '../../../formats/esp';
import type { CsvRow } from '../../../types';
import {
  discoverLocaleSources,
  generateImportCsvRows,
  loadLocaleStrings,
  resolveEnglishLocaleSource,
} from '../modImportLocaleStream';
import type { ModImportApplyRow } from './types';

const resolveEnglishLocaleMap = (
  localeSources: ReturnType<typeof discoverLocaleSources>,
): Map<number, string> | undefined => {
  const source = resolveEnglishLocaleSource(localeSources);
  return source ? loadLocaleStrings(source) : undefined;
};

const materializeImportCsvRows = (
  espRows: EspStringRow[],
  stringsMap: Map<number, string> | null,
): CsvRow[] => [...generateImportCsvRows(espRows, stringsMap)];

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

export { resolveEnglishLocaleMap, materializeImportCsvRows, toApplyRows };

/**
 * Loading of locale string tables and streaming row generation.
 *
 * Loads one locale at a time instead of materializing Map<locale, Map<id, text>>
 * for every language before DB writes. Sources come from `localeSources.ts`.
 */
import fs from 'node:fs';
import { BsaReader } from '../../formats/bsa';
import { getBa2Reader } from '../../formats/ba2';
import {
  parseStringsBuffer,
  resolveStringsTableTypeForRow,
  type StringsType,
} from '../../formats/strings';
import type { EspStringRow } from '../../formats/esp';
import type { CsvRow, GameType } from '../../types';
import { MOD_IMPORT_DEFAULT_SOURCE_LOCALE } from './localeHelpers';
import { localeSourcesByLocale, type LocaleStringsSource } from './localeSources';

export type LocaleStringsMaps = Map<StringsType, Map<number, string>>;

const emptyLocaleStringsMaps = (): LocaleStringsMaps =>
  new Map([
    ['STRINGS', new Map()],
    ['DLSTRINGS', new Map()],
    ['ILSTRINGS', new Map()],
  ]);

/** Load lstring id → text maps split by STRINGS / DLSTRINGS / ILSTRINGS. */
export const loadLocaleStringsByType = (source: LocaleStringsSource): LocaleStringsMaps => {
  const maps = emptyLocaleStringsMaps();
  for (const file of source.files) {
    const buf =
      file.kind === 'loose'
        ? fs.readFileSync(file.filePath)
        : file.kind === 'ba2'
          ? getBa2Reader(file.archivePath).extractByName(file.entryName)
          : (() => {
              const reader = new BsaReader(file.archivePath);
              const entry = reader.list().find((e) => e.name === file.entryName);
              return entry ? reader.extractEntry(entry) : null;
            })();
    if (!buf) continue;
    const bucket = maps.get(file.type) ?? new Map<number, string>();
    for (const [id, text] of parseStringsBuffer(buf, file.type)) {
      bucket.set(id, text);
    }
    maps.set(file.type, bucket);
  }
  return maps;
};

const resolveLstringText = (
  row: EspStringRow,
  stringsMaps: LocaleStringsMaps | null,
  game: GameType,
): string | null => {
  if (!stringsMaps) return null;
  const id = Number.parseInt(row.text, 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  const table = resolveStringsTableTypeForRow(game, row.signature, row.path);
  const text = stringsMaps.get(table)?.get(id);
  return text || null;
};

/** Count importable rows without allocating CsvRow objects. */
export const countImportRowsForLocale = (
  espRows: EspStringRow[],
  stringsMaps: LocaleStringsMaps | null,
  game: GameType = 'fo4',
): number => {
  let count = 0;
  for (const row of espRows) {
    if (row.isLstringId) {
      if (!resolveLstringText(row, stringsMaps, game)) continue;
    }
    count++;
  }
  return count;
};

/** Yield CsvRow objects one at a time for a single locale. */
export function* generateImportCsvRows(
  espRows: EspStringRow[],
  stringsMaps: LocaleStringsMaps | null,
  game: GameType = 'fo4',
): Generator<CsvRow> {
  for (const row of espRows) {
    let text: string;
    if (row.isLstringId) {
      const resolved = resolveLstringText(row, stringsMaps, game);
      if (!resolved) continue;
      text = resolved;
    } else {
      text = row.text;
    }
    yield {
      FormID: row.formId,
      Signature: row.signature,
      EDID: row.edid || undefined,
      Path: `${row.signature}\\${row.path}`,
      LStringID: row.isLstringId ? parseInt(row.text, 10) : undefined,
      Source: text,
      DialogTopicFormID: row.dialogTopicFormId,
      PreviousInfoFormID: row.previousInfoFormId,
      SpeakerFormID: row.speakerFormId,
    };
  }
}

/** Pick the English (or best available) locale source for NPC-name resolution. */
export const resolveEnglishLocaleSource = (
  sources: LocaleStringsSource[],
): LocaleStringsSource | undefined => {
  const byLocale = localeSourcesByLocale(sources);
  const preferred = ['en', 'english', MOD_IMPORT_DEFAULT_SOURCE_LOCALE];
  for (const key of preferred) {
    const hit = byLocale.get(key);
    if (hit) return hit;
  }
  return sources[0];
};

/**
 * Load the English STRINGS/DLSTRINGS/ILSTRINGS maps for a localized plugin.
 *
 * English is the alignment anchor: imported rows are keyed against it so that
 * other locales of the same plugin land on the same records.
 */
export const resolveEnglishLocaleMaps = (
  localeSources: LocaleStringsSource[],
): LocaleStringsMaps | undefined => {
  const source = resolveEnglishLocaleSource(localeSources);
  return source ? loadLocaleStringsByType(source) : undefined;
};

/**
 * Estimate total import rows for localized mods (same resolve rate assumed per locale).
 * Loads one sample locale map; callers should discard it after use.
 */
export const estimateLocalizedImportTotal = (
  espRows: EspStringRow[],
  sources: LocaleStringsSource[],
  locales: string[],
  game: GameType = 'fo4',
): number => {
  if (locales.length === 0) return 0;
  const sample =
    sources.find((s) => locales.includes(s.locale)) ??
    sources.find((s) => s.locale === resolveEnglishLocaleSource(sources)?.locale);
  if (!sample) return espRows.length * locales.length;
  const sampleMaps = loadLocaleStringsByType(sample);
  const perLocale = countImportRowsForLocale(espRows, sampleMaps, game);
  return perLocale * locales.length;
};

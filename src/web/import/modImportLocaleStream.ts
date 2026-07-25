/**
 * Streaming STRINGS locale discovery and row generation for mod import.
 *
 * Loads one locale at a time instead of materializing Map<locale, Map<id, text>>
 * for every language before DB writes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { BsaReader } from '../../formats/bsa';
import { getBa2Reader, isBa2GnrArchive } from '../../formats/ba2';
import {
  parseStringsBuffer,
  resolveStringsTableTypeForRow,
  stringsTypeFromPath,
  type StringsType,
} from '../../formats/strings';
import type { EspStringRow } from '../../formats/esp';
import type { CsvRow, GameType } from '../../types';
import { logImport } from '../../logging/loggers';

export type LocaleStringsFileRef =
  | { kind: 'loose'; filePath: string; type: StringsType }
  | { kind: 'ba2'; archivePath: string; entryName: string; type: StringsType }
  | { kind: 'bsa'; archivePath: string; entryName: string; type: StringsType };

export type LocaleStringsSource = {
  locale: string;
  files: LocaleStringsFileRef[];
};

const STRINGS_FILE_RE = /_([a-z]+)\.(strings|dlstrings|ilstrings)$/i;

/** Parse locale tag from a STRINGS-family file basename. */
export const localeFromStringsFileName = (fileName: string): string | null => {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? fileName;
  const m = base.match(STRINGS_FILE_RE);
  return m ? m[1].toLowerCase() : null;
};

const addLocaleFile = (
  catalog: Map<string, LocaleStringsFileRef[]>,
  locale: string,
  file: LocaleStringsFileRef,
): void => {
  const bucket = catalog.get(locale) ?? [];
  bucket.push(file);
  catalog.set(locale, bucket);
};

const catalogToSources = (catalog: Map<string, LocaleStringsFileRef[]>): LocaleStringsSource[] =>
  [...catalog.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([locale, files]) => ({ locale, files }));

const discoverLooseLocaleSources = (espPath: string): LocaleStringsSource[] => {
  const dir = path.join(path.dirname(espPath), 'Strings');
  const catalog = new Map<string, LocaleStringsFileRef[]>();
  if (!fs.existsSync(dir)) return [];

  for (const file of fs.readdirSync(dir)) {
    const locale = localeFromStringsFileName(file);
    if (!locale) continue;
    addLocaleFile(catalog, locale, {
      kind: 'loose',
      filePath: path.join(dir, file),
      type: stringsTypeFromPath(file),
    });
  }

  return catalogToSources(catalog);
};

const discoverBa2LocaleSources = (ba2Path: string): LocaleStringsSource[] => {
  const reader = getBa2Reader(ba2Path);
  const catalog = new Map<string, LocaleStringsFileRef[]>();

  const stringsEntries = [
    ...reader.listByExt('strings'),
    ...reader.listByExt('dlstrings'),
    ...reader.listByExt('ilstrings'),
  ];

  for (const entry of stringsEntries) {
    const base = entry.name.replace(/\\/g, '/').split('/').pop() ?? entry.name;
    const locale = localeFromStringsFileName(base);
    if (!locale) continue;
    addLocaleFile(catalog, locale, {
      kind: 'ba2',
      archivePath: ba2Path,
      entryName: entry.name,
      type: stringsTypeFromPath(entry.name),
    });
  }

  return catalogToSources(catalog);
};

const discoverBsaLocaleSources = (bsaPath: string): LocaleStringsSource[] => {
  const reader = new BsaReader(bsaPath);
  const catalog = new Map<string, LocaleStringsFileRef[]>();

  const stringsEntries = [
    ...reader.listByExt('strings'),
    ...reader.listByExt('dlstrings'),
    ...reader.listByExt('ilstrings'),
  ];

  for (const entry of stringsEntries) {
    const base = entry.name.replace(/\\/g, '/').split('/').pop() ?? entry.name;
    const locale = localeFromStringsFileName(base);
    if (!locale) continue;
    addLocaleFile(catalog, locale, {
      kind: 'bsa',
      archivePath: bsaPath,
      entryName: entry.name,
      type: stringsTypeFromPath(entry.name),
    });
  }

  return catalogToSources(catalog);
};

const discoverBa2 = (
  modPath: string,
  ba2Candidates: string[],
  game: GameType = 'fo4',
): string | null => {
  const stem = path.basename(modPath, path.extname(modPath)).toLowerCase();
  const baseStem = path.basename(modPath, path.extname(modPath));
  const suffixes =
    game === 'fo4' || game === 'fo76' ? [' - main', ' - interface', ''] : [' - main', ''];

  for (const suffix of suffixes) {
    const target = suffix ? `${stem}${suffix}` : stem;
    for (const ba2 of ba2Candidates) {
      if (path.basename(ba2, '.ba2').toLowerCase() === target) return ba2;
    }
  }

  const dir = path.dirname(modPath);
  for (const suffix of suffixes) {
    const candidate = suffix ? `${baseStem}${suffix}.ba2` : `${baseStem}.ba2`;
    const p = path.join(dir, candidate);
    if (fs.existsSync(p)) return p;
  }
  return null;
};

const discoverBsa = (modPath: string, bsaCandidates: string[]): string | null => {
  const stem = path.basename(modPath, path.extname(modPath)).toLowerCase();
  const variants = [`${stem} - strings`, `${stem} - textures`, stem];
  for (const bsa of bsaCandidates) {
    const base = path.basename(bsa, '.bsa').toLowerCase();
    if (variants.includes(base)) return bsa;
  }
  const dir = path.dirname(modPath);
  for (const variant of variants) {
    const p = path.join(dir, `${variant}.bsa`);
    if (fs.existsSync(p)) return p;
  }
  return null;
};

const tryDiscoverBa2LocaleSources = (ba2Path: string): LocaleStringsSource[] | null => {
  try {
    const locales = discoverBa2LocaleSources(ba2Path);
    return locales.length > 0 ? locales : null;
  } catch (err) {
    logImport.warn(
      `STRINGS: could not read BA2 "${path.basename(ba2Path)}": ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
};

const discoverFo4LocaleSources = (
  espPath: string,
  game: GameType,
  ba2Candidates: string[],
): LocaleStringsSource[] => {
  const loose = discoverLooseLocaleSources(espPath);
  if (loose.length > 0) return loose;

  const ba2Cands = ba2Candidates.filter((f) => f.toLowerCase().endsWith('.ba2'));
  const primaryBa2 = discoverBa2(espPath, ba2Cands, game);
  if (primaryBa2) {
    const fromPrimary = tryDiscoverBa2LocaleSources(primaryBa2);
    if (fromPrimary) return fromPrimary;
  }

  const stem = path.basename(espPath, path.extname(espPath)).toLowerCase();
  for (const ba2 of ba2Cands) {
    if (ba2 === primaryBa2) continue;
    const base = path.basename(ba2, '.ba2').toLowerCase();
    if (!base.startsWith(stem)) continue;
    if (!isBa2GnrArchive(ba2)) continue;
    const fromBa2 = tryDiscoverBa2LocaleSources(ba2);
    if (fromBa2) return fromBa2;
  }

  return loose;
};

const discoverBsaGameLocaleSources = (
  espPath: string,
  ba2Candidates: string[],
): LocaleStringsSource[] => {
  const bsaCandidates = ba2Candidates.filter((f) => f.toLowerCase().endsWith('.bsa'));
  const bsaPath = discoverBsa(espPath, bsaCandidates);
  if (bsaPath) return discoverBsaLocaleSources(bsaPath);
  return discoverLooseLocaleSources(espPath);
};

/**
 * Discover STRINGS/DLSTRINGS/ILSTRINGS locale files without loading string text.
 */
export const discoverLocaleSources = (
  espPath: string,
  game: GameType,
  archiveCandidates: string[] = [],
): LocaleStringsSource[] => {
  if (game === 'sse' || game === 'sle' || game === 'fo3' || game === 'fnv') {
    return discoverBsaGameLocaleSources(espPath, archiveCandidates);
  }
  return discoverFo4LocaleSources(espPath, game, archiveCandidates);
};

/** Map locale tag → source descriptor for O(1) lookup during import. */
export const localeSourcesByLocale = (
  sources: LocaleStringsSource[],
): Map<string, LocaleStringsSource> => new Map(sources.map((s) => [s.locale, s]));

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

/**
 * @deprecated Prefer {@link loadLocaleStringsByType} — merged ids collide across tables.
 */
export const loadLocaleStrings = (source: LocaleStringsSource): Map<number, string> => {
  const merged = new Map<number, string>();
  for (const map of loadLocaleStringsByType(source).values()) {
    for (const [id, text] of map) merged.set(id, text);
  }
  return merged;
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

export const MOD_IMPORT_DEFAULT_SOURCE_LOCALE = 'en';

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

/** Sum exact per-locale counts (one map load per locale, no CsvRow allocation). */
export const countLocalizedImportTotalExact = (
  espRows: EspStringRow[],
  sources: LocaleStringsSource[],
  locales: string[],
  game: GameType = 'fo4',
): number => {
  const byLocale = localeSourcesByLocale(sources);
  let total = 0;
  for (const locale of locales) {
    const source = byLocale.get(locale);
    if (!source) continue;
    const maps = loadLocaleStringsByType(source);
    total += countImportRowsForLocale(espRows, maps, game);
  }
  return total;
};

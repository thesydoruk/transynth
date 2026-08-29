/**
 * Discovery of STRINGS/DLSTRINGS/ILSTRINGS locale files for a plugin.
 *
 * Only catalogs where each locale's files live (loose dir, BA2 or BSA) without
 * loading any string text — loading happens per locale in `localeRows.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { BsaReader } from '../../formats/bsa';
import { getBa2Reader, isBa2GnrArchive } from '../../formats/ba2';
import { stringsTypeFromPath, resolveLooseStringsDirForPlugin } from '../../formats/strings';
import type { StringsType } from '../../formats/strings';
import type { GameType } from '../../types';
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
  const dir = resolveLooseStringsDirForPlugin(espPath);
  const catalog = new Map<string, LocaleStringsFileRef[]>();
  if (!dir) return [];

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

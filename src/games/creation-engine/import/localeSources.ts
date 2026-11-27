/**
 * Discovery of STRINGS/DLSTRINGS/ILSTRINGS locale files for a plugin.
 *
 * Only catalogs where each locale's files live (loose dir, BA2 or BSA) without
 * loading any string text — loading happens per locale in `localeRows.ts`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { BsaReader } from '../../../formats/bsa';
import {
  discoverBa2Candidate,
  findFileIgnoringCase,
  getBa2Reader,
  isBa2GnrArchive,
} from '../../../formats/ba2';
import { readPluginMasterNames } from '../../../formats/esp';
import { stringsTypeFromPath, resolveLooseStringsDirForPlugin } from '../../../formats/strings';
import type { StringsType } from '../../../formats/strings';
import type { CreationEngineTitle } from '../title';
import { logImport } from '../../../logging/loggers';
import { parsePluginStringsFileName } from '../../../formats/strings/stringsFileName';

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

/** Loose tables next to the plugin — only its own `<stem>_<locale>.*`, as the engine reads them. */
const discoverLooseLocaleSources = (espPath: string): LocaleStringsSource[] => {
  const dir = resolveLooseStringsDirForPlugin(espPath);
  const catalog = new Map<string, LocaleStringsFileRef[]>();
  if (!dir) return [];

  const stem = path.basename(espPath, path.extname(espPath));
  for (const file of fs.readdirSync(dir)) {
    const parsed = parsePluginStringsFileName(file, stem);
    if (!parsed) continue;
    addLocaleFile(catalog, parsed.locale, {
      kind: 'loose',
      filePath: path.join(dir, file),
      type: parsed.type,
    });
  }

  return catalogToSources(catalog);
};

/**
 * Every STRINGS-family table in a BA2. With `pluginStem`, only that plugin's
 * own `<stem>_<locale>.*` — the engine finds a plugin's tables by file name.
 */
const readBa2LocaleSources = (ba2Path: string, pluginStem?: string): LocaleStringsSource[] => {
  const reader = getBa2Reader(ba2Path);
  const catalog = new Map<string, LocaleStringsFileRef[]>();

  const stringsEntries = [
    ...reader.listByExt('strings'),
    ...reader.listByExt('dlstrings'),
    ...reader.listByExt('ilstrings'),
  ];

  for (const entry of stringsEntries) {
    const base = entry.name.replace(/\\/g, '/').split('/').pop() ?? entry.name;
    if (pluginStem && !parsePluginStringsFileName(base, pluginStem)) continue;
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

const tryReadBa2LocaleSources = (
  ba2Path: string,
  pluginStem?: string,
): LocaleStringsSource[] | null => {
  try {
    const locales = readBa2LocaleSources(ba2Path, pluginStem);
    return locales.length > 0 ? locales : null;
  } catch (err) {
    logImport.warn(
      `STRINGS: could not read BA2 "${path.basename(ba2Path)}": ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
};

/**
 * A plugin's own tables when the archive holds them, else every table in it.
 *
 * An archive can carry a second plugin's tables beside its own — Starfield's
 * `SFBGS050 - Main.ba2` also holds `blueprintships-sfbgs050_*` — and string ids
 * of two plugins overlap. An archive with no table named for the plugin is
 * still read whole, as it always was.
 */
const readPluginBa2LocaleSources = (
  ba2Path: string,
  pluginStem: string,
): LocaleStringsSource[] | null =>
  tryReadBa2LocaleSources(ba2Path, pluginStem) ?? tryReadBa2LocaleSources(ba2Path);

/**
 * The title's own string-table archives, `<stem><suffix>.ba2` in the title's
 * order — among the candidates first, then on disk next to the plugin.
 */
export const findTitleStringsArchives = (
  espPath: string,
  ba2Candidates: string[],
  suffixes: readonly string[],
): string[] => {
  const stem = path.basename(espPath, path.extname(espPath));
  const found: string[] = [];
  for (const suffix of suffixes) {
    const fileName = `${stem}${suffix}.ba2`;
    const candidate = ba2Candidates.find(
      (f) => path.basename(f).toLowerCase() === fileName.toLowerCase(),
    );
    const archive = candidate ?? findFileIgnoringCase(path.dirname(espPath), fileName);
    if (archive && !found.includes(archive)) found.push(archive);
  }
  return found;
};

/**
 * Archives of the plugin's masters that may hold the plugin's tables, nearest
 * master first: a plugin with no archive of its own can ship its tables in the
 * archive of the master it extends (Starfield's `BlueprintShips-SFBGS050.esm`
 * keeps `blueprintships-sfbgs050_*` in `SFBGS050 - Main.ba2`). Only each
 * master's string-table archive and Creation Kit companion — never its whole
 * set, which for a base game is dozens of multi-gigabyte archives.
 */
export const findMasterStringsArchives = (
  espPath: string,
  ba2Candidates: string[],
  titleSuffixes: readonly string[],
): string[] => {
  let masters: string[];
  try {
    masters = readPluginMasterNames(espPath);
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const master of masters.reverse()) {
    const masterPath = path.join(path.dirname(espPath), master);
    const companion = discoverBa2Candidate(masterPath, ba2Candidates, 'ba2');
    for (const archive of [
      ...findTitleStringsArchives(masterPath, ba2Candidates, titleSuffixes),
      ...(companion ? [companion] : []),
    ]) {
      if (!found.includes(archive)) found.push(archive);
    }
  }
  return found;
};

const discoverBa2LocaleSourcesForPlugin = (
  espPath: string,
  ba2Candidates: string[],
  titleSuffixes: readonly string[],
): LocaleStringsSource[] => {
  const ba2Cands = ba2Candidates.filter((f) => f.toLowerCase().endsWith('.ba2'));
  const pluginStem = path.basename(espPath, path.extname(espPath));
  for (const archive of findTitleStringsArchives(espPath, ba2Cands, titleSuffixes)) {
    const fromTitleArchive = tryReadBa2LocaleSources(archive, pluginStem);
    if (fromTitleArchive) return fromTitleArchive;
  }

  const primaryBa2 = discoverBa2Candidate(espPath, ba2Cands, 'ba2');
  if (primaryBa2) {
    const fromPrimary = readPluginBa2LocaleSources(primaryBa2, pluginStem);
    if (fromPrimary) return fromPrimary;
  }

  const stem = pluginStem.toLowerCase();
  for (const ba2 of ba2Cands) {
    if (ba2 === primaryBa2) continue;
    const base = path.basename(ba2, '.ba2').toLowerCase();
    if (!base.startsWith(stem)) continue;
    if (!isBa2GnrArchive(ba2)) continue;
    const fromBa2 = readPluginBa2LocaleSources(ba2, pluginStem);
    if (fromBa2) return fromBa2;
  }

  for (const archive of findMasterStringsArchives(espPath, ba2Cands, titleSuffixes)) {
    const fromMaster = tryReadBa2LocaleSources(archive, pluginStem);
    if (fromMaster) return fromMaster;
  }

  return [];
};

const discoverBsaLocaleSourcesForPlugin = (
  espPath: string,
  archiveCandidates: string[],
): LocaleStringsSource[] => {
  const bsaCandidates = archiveCandidates.filter((f) => f.toLowerCase().endsWith('.bsa'));
  const bsaPath = discoverBsa(espPath, bsaCandidates);
  return bsaPath ? discoverBsaLocaleSources(bsaPath) : [];
};

/**
 * Discover STRINGS/DLSTRINGS/ILSTRINGS locale files without loading string text.
 *
 * Where to look is the title's business: Skyrim and the Gamebryo Fallouts keep
 * their tables in a BSA, Fallout 4 / 76 in a BA2, Starfield in a BA2 named for
 * its role (`- Localization`), and any title may ship them loose next to the
 * plugin. The first container that yields tables wins.
 */
export const discoverLocaleSources = (
  espPath: string,
  title: CreationEngineTitle,
  archiveCandidates: string[] = [],
): LocaleStringsSource[] => {
  for (const container of title.strings.lookupOrder) {
    const found =
      container === 'bsa'
        ? discoverBsaLocaleSourcesForPlugin(espPath, archiveCandidates)
        : container === 'ba2'
          ? discoverBa2LocaleSourcesForPlugin(
              espPath,
              archiveCandidates,
              title.strings.archiveSuffixes ?? [],
            )
          : discoverLooseLocaleSources(espPath);
    if (found.length > 0) return found;
  }
  return [];
};

/** Map locale tag → source descriptor for O(1) lookup during import. */
export const localeSourcesByLocale = (
  sources: LocaleStringsSource[],
): Map<string, LocaleStringsSource> => new Map(sources.map((s) => [s.locale, s]));

import fs from 'node:fs';
import path from 'node:path';
import type { GameId } from '../../../types';
import { Ba2Reader } from '../../../formats/ba2';
import { BsaReader } from '../../../formats/bsa';
import {
  parseStringsBuffer,
  resolveLooseStringsDirForPlugin,
  type StringsType,
} from '../../../formats/strings';
import {
  parsePluginStringsFileName,
  parseStringsFileName,
} from '../../../formats/strings/stringsFileName';
import { log } from '../../../logger';
import { listCompanionGnrlBa2ForPlugin } from '../../../import/mod/discovery';
import { findMasterStringsArchives, findTitleStringsArchives } from '../import/localeSources';
import { discoverCompanionBa2 } from './archiveExportPlan';
import { DEFAULT_GAME_ID } from '../../registry';
import { creationEngineTitle } from '../registry';

/**
 * Parsed source strings table loaded from the original mod distribution.
 *
 * Each table includes its original file name (for inventory preservation),
 * its derived stem and type, and a full `lstring_id → sourceText` map.
 */
export type SourceStringsFile = {
  sourceFileName: string;
  nameStem: string;
  type: StringsType;
  sourceMap: Map<number, string>;
};

/**
 * Keep strings file export order deterministic regardless of filesystem or
 * archive iteration order.
 *
 * @param files - Parsed source strings files.
 * @returns A stable, case-insensitive sort by source file name.
 */
const sortSourceStringsFiles = (files: SourceStringsFile[]): SourceStringsFile[] => {
  const typeOrder: Record<StringsType, number> = {
    STRINGS: 0,
    DLSTRINGS: 1,
    ILSTRINGS: 2,
  };

  return [...files].sort((left, right) => {
    const stemCompare = left.nameStem.localeCompare(right.nameStem, undefined, {
      sensitivity: 'base',
    });
    if (stemCompare !== 0) return stemCompare;
    return typeOrder[left.type] - typeOrder[right.type];
  });
};

/**
 * Discover a BSA archive (Skyrim SE) next to the mod plugin file.
 * Prefers "Stem - Strings.bsa", then "Stem.bsa".
 */
const findBsa = (modPath: string): string | null => {
  const dir = path.dirname(modPath);
  const stem = path.basename(modPath, path.extname(modPath));
  for (const candidate of [`${stem} - Strings.bsa`, `${stem}.bsa`]) {
    const full = path.join(dir, candidate);
    if (fs.existsSync(full)) return full;
  }
  return null;
};

/**
 * Load source STRINGS files from a BSA archive (Skyrim SE/LE).
 */
const loadSourceStringsFromBSA = (bsaPath: string, srcLang: string): SourceStringsFile[] => {
  const bsa = new BsaReader(bsaPath);
  const files: SourceStringsFile[] = [];

  for (const ext of ['strings', 'dlstrings', 'ilstrings'] as const) {
    for (const entry of bsa.listByExt(ext)) {
      const base = entry.name.replace(/\\/g, '/').split('/').pop() ?? '';
      const parsed = parseStringsFileName(base);
      if (!parsed || parsed.locale !== srcLang.toLowerCase()) continue;
      const sourceMap = parseStringsBuffer(bsa.extractEntry(entry), parsed.type);
      files.push({
        sourceFileName: base,
        nameStem: parsed.stem,
        type: parsed.type,
        sourceMap,
      });
    }
  }

  return sortSourceStringsFiles(files);
};

/**
 * Load source STRINGS tables from a BA2 archive for the requested locale.
 *
 * @param ba2Path - Absolute path to the BA2 archive.
 * @param srcLang - Locale suffix expected in file names (e.g. `"en"`).
 * @param pluginStem - When set, only that plugin's own tables.
 * @returns Stable-sorted list of parsed source strings tables.
 */
const loadSourceStringsFromBA2 = (
  ba2Path: string,
  srcLang: string,
  pluginStem?: string,
): SourceStringsFile[] => {
  const ba2 = new Ba2Reader(ba2Path);
  const files: SourceStringsFile[] = [];

  try {
    for (const ext of ['strings', 'dlstrings', 'ilstrings'] as const) {
      for (const entry of ba2.listByExt(ext)) {
        const base = entry.name.replace(/\\/g, '/').split('/').pop() ?? '';
        const parsed = pluginStem
          ? parsePluginStringsFileName(base, pluginStem)
          : parseStringsFileName(base);
        if (!parsed || parsed.locale !== srcLang.toLowerCase()) continue;
        const sourceMap = parseStringsBuffer(ba2.extractEntry(entry), parsed.type);
        files.push({
          sourceFileName: base,
          nameStem: parsed.stem,
          type: parsed.type,
          sourceMap,
        });
      }
    }
  } finally {
    ba2.close();
  }

  return sortSourceStringsFiles(files);
};

/** {@link loadSourceStringsFromBA2}, with a read failure logged as "nothing here". */
const tryLoadSourceStringsFromBA2 = (
  ba2Path: string,
  srcLang: string,
  pluginStem?: string,
): SourceStringsFile[] => {
  try {
    return loadSourceStringsFromBA2(ba2Path, srcLang, pluginStem);
  } catch (err) {
    log.warn(
      `STRINGS export: failed to read source tables from ${path.basename(ba2Path)}: ${
        err instanceof Error ? err.message : String(err)
      }; trying the next source`,
    );
    return [];
  }
};

/**
 * Load source STRINGS tables from loose files next to the plugin.
 *
 * This is supported for mods distributed with a `Strings\\` directory rather
 * than an archive.
 *
 * @param modPath - Absolute path to the mod plugin file.
 * @param srcLang - Locale suffix expected in file names (e.g. `"en"`).
 * @returns Stable-sorted list of parsed source strings tables.
 */
const loadSourceStringsFromLooseFiles = (modPath: string, srcLang: string): SourceStringsFile[] => {
  const dir = resolveLooseStringsDirForPlugin(modPath);
  if (!dir) return [];

  const stem = path.basename(modPath, path.extname(modPath));
  const files: SourceStringsFile[] = [];
  for (const file of fs.readdirSync(dir)) {
    const parsed = parsePluginStringsFileName(file, stem);
    if (!parsed || parsed.locale !== srcLang.toLowerCase()) continue;
    const sourceMap = parseStringsBuffer(fs.readFileSync(path.join(dir, file)), parsed.type);
    files.push({
      sourceFileName: file,
      nameStem: parsed.stem,
      type: parsed.type,
      sourceMap,
    });
  }

  return sortSourceStringsFiles(files);
};

/**
 * Load every source strings table for a mod and locale.
 *
 * Where to look is the title's business: Skyrim and the Gamebryo Fallouts keep
 * their tables in a BSA, Fallout 4 / 76 in a BA2, Starfield in a BA2 named for
 * its role (`- Localization`), and any title may ship them loose under
 * `Strings\`. The first container that yields tables wins.
 *
 * @param modPath - Absolute path to the mod plugin file.
 * @param srcLang - Source locale suffix (e.g. `"en"`).
 * @param game - Which Creation Engine title the mod is for.
 */
export const loadSourceStringsFiles = (
  modPath: string,
  srcLang: string,
  game: GameId = DEFAULT_GAME_ID,
): SourceStringsFile[] => {
  const title = creationEngineTitle(game);

  for (const container of title.strings.lookupOrder) {
    if (container === 'bsa') {
      const bsaPath = findBsa(modPath);
      const files = bsaPath ? loadSourceStringsFromBSA(bsaPath, srcLang) : [];
      if (files.length > 0) return files;
      continue;
    }

    if (container === 'ba2') {
      const stem = path.basename(modPath, path.extname(modPath));
      // Same order as the import (`discoverLocaleSources`): the title's own
      // string-table archives, then the Creation Kit companion, then the
      // plugin's other archives (Starfield's Shattered Space keeps its tables
      // in `- Main02`). Each gives the plugin's own tables by name; only the
      // companion is read whole when none is named for the plugin, as it
      // always was.
      const tried = new Set<string>();
      const fromArchive = (ba2Path: string, wholeIfUnnamed: boolean): SourceStringsFile[] => {
        if (tried.has(ba2Path)) return [];
        tried.add(ba2Path);
        const own = tryLoadSourceStringsFromBA2(ba2Path, srcLang, stem);
        if (own.length > 0 || !wholeIfUnnamed) return own;
        return tryLoadSourceStringsFromBA2(ba2Path, srcLang);
      };

      for (const ba2Path of findTitleStringsArchives(
        modPath,
        [],
        title.strings.archiveSuffixes ?? [],
      )) {
        const files = fromArchive(ba2Path, false);
        if (files.length > 0) return files;
      }
      const companion = discoverCompanionBa2(modPath, title.archive.kind);
      if (companion) {
        const files = fromArchive(companion, true);
        if (files.length > 0) return files;
      }
      // No candidate list: the plugin's own folder is listed, never walked. The
      // default list falls back to a recursive walk of the parent folder when
      // the plugin's has no archive — the whole mod store, on a server.
      for (const ba2Path of [
        ...listCompanionGnrlBa2ForPlugin(modPath, []).sort(),
        ...findMasterStringsArchives(modPath, [], title.strings.archiveSuffixes ?? []),
      ]) {
        const files = fromArchive(ba2Path, false);
        if (files.length > 0) return files;
      }
      continue;
    }

    const files = loadSourceStringsFromLooseFiles(modPath, srcLang);
    if (files.length > 0) return files;
  }

  return [];
};

import fs from 'node:fs';
import path from 'node:path';
import type { GameId } from '../../types';
import { Ba2Reader } from '../../formats/ba2';
import { BsaReader } from '../../formats/bsa';
import {
  parseStringsBuffer,
  resolveLooseStringsDirForPlugin,
  stringsTypeFromPath,
  type StringsType,
} from '../../formats/strings';
import { log } from '../../logger';
import { discoverCompanionBa2 } from './archiveExportPlan';
import { DEFAULT_GAME_ID } from '../../games/registry';
import { creationEngineTitle } from '../../games/creation-engine/registry';

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
 * Parse a localized strings table file name while preserving the original
 * basename casing.
 *
 * Expected shape: `{Stem}_{locale}.{STRINGS|DLSTRINGS|ILSTRINGS}`.
 * Matching is case-insensitive, but the returned stem keeps the exact bytes
 * from the original file name so exports can preserve the visible file naming.
 *
 * @param fileName - Basename only, without directory components.
 * @returns Parsed descriptor or null if the file is not a strings table.
 */
const parseStringsFileName = (
  fileName: string,
): { nameStem: string; locale: string; type: StringsType } | null => {
  const match = fileName.match(/^(.*)_([a-z]+)\.(strings|dlstrings|ilstrings)$/i);
  if (!match) return null;
  return {
    nameStem: match[1],
    locale: match[2].toLowerCase(),
    type: stringsTypeFromPath(fileName),
  };
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
        nameStem: parsed.nameStem,
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
 * @returns Stable-sorted list of parsed source strings tables.
 */
const loadSourceStringsFromBA2 = (ba2Path: string, srcLang: string): SourceStringsFile[] => {
  const ba2 = new Ba2Reader(ba2Path);
  const files: SourceStringsFile[] = [];

  for (const ext of ['strings', 'dlstrings', 'ilstrings'] as const) {
    for (const entry of ba2.listByExt(ext)) {
      const base = entry.name.replace(/\\/g, '/').split('/').pop() ?? '';
      const parsed = parseStringsFileName(base);
      if (!parsed || parsed.locale !== srcLang.toLowerCase()) continue;
      const sourceMap = parseStringsBuffer(ba2.extractEntry(entry), parsed.type);
      files.push({
        sourceFileName: base,
        nameStem: parsed.nameStem,
        type: parsed.type,
        sourceMap,
      });
    }
  }

  return sortSourceStringsFiles(files);
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

  const files: SourceStringsFile[] = [];
  for (const file of fs.readdirSync(dir)) {
    const parsed = parseStringsFileName(file);
    if (!parsed || parsed.locale !== srcLang.toLowerCase()) continue;
    const sourceMap = parseStringsBuffer(fs.readFileSync(path.join(dir, file)), parsed.type);
    files.push({
      sourceFileName: file,
      nameStem: parsed.nameStem,
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
 * their tables in a BSA, Fallout 4 / 76 in a BA2, and any title may ship them
 * loose under `Strings\`. The first container that yields tables wins.
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
      const ba2Path = discoverCompanionBa2(modPath, title.archive.kind);
      if (!ba2Path) continue;
      try {
        const files = loadSourceStringsFromBA2(ba2Path, srcLang);
        if (files.length > 0) return files;
      } catch (err) {
        log.warn(
          `STRINGS export: failed to read source tables from ${path.basename(ba2Path)}: ${
            err instanceof Error ? err.message : String(err)
          }; trying the next source`,
        );
      }
      continue;
    }

    const files = loadSourceStringsFromLooseFiles(modPath, srcLang);
    if (files.length > 0) return files;
  }

  return [];
};

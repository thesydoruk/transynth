import fs from 'node:fs';
import path from 'node:path';
import type { GameType } from '../../types';
import { Ba2Reader } from '../../formats/ba2';
import { BsaReader } from '../../formats/bsa';
import { parseStringsBuffer, stringsTypeFromPath, type StringsType } from '../../formats/strings';
import { log } from '../../logger';
import { discoverCompanionBa2 } from './archiveExportPlan';

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
  const dir = path.join(path.dirname(modPath), 'Strings');
  if (!fs.existsSync(dir)) return [];

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
 * Load all source strings tables for a given mod and locale.
 *
 * The search order depends on the game:
 * - Skyrim: BSA → BA2 → loose files.
 * - Fallout 4/76: BA2 → loose files.
 *
 * @param modPath - Absolute path to the mod plugin file.
 * @param srcLang - Source locale suffix (e.g. `"en"`).
 * @param game - Target game type (controls which archive types to probe first).
 * @returns Stable-sorted list of parsed source strings tables.
 */
export const loadSourceStringsFiles = (
  modPath: string,
  srcLang: string,
  game: GameType = 'fo4',
): SourceStringsFile[] => {
  if (game === 'sse' || game === 'sle') {
    const bsaPath = findBsa(modPath);
    if (bsaPath) {
      const bsaFiles = loadSourceStringsFromBSA(bsaPath, srcLang);
      if (bsaFiles.length > 0) return bsaFiles;
    }
  }
  const ba2Path = discoverCompanionBa2(modPath, game);
  if (ba2Path) {
    try {
      const ba2Files = loadSourceStringsFromBA2(ba2Path, srcLang);
      if (ba2Files.length > 0) return ba2Files;
    } catch (err) {
      log.warn(
        `STRINGS export: failed to read source tables from ${path.basename(ba2Path)}: ${
          err instanceof Error ? err.message : String(err)
        }; falling back to loose Strings\\`,
      );
    }
  }
  return loadSourceStringsFromLooseFiles(modPath, srcLang);
};

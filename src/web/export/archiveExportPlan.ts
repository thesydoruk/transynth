import fs from 'node:fs';
import path from 'node:path';
import type { GameType } from '../../types';
import {
  defaultArchiveFileName,
  shouldCompressArchiveEntry,
  usesBa2Archives,
} from '../../formats/ba2';
import type { ArchiveInputFile } from '../../formats/types';
import { readModImportExtractManifest } from '../../modImport/archiveManifest';
import { resolveModImportExtractRoot } from '../../modStorage/paths';

const STRINGS_LOOSE_RE = /^strings\/.*\.(strings|dlstrings|ilstrings)$/i;

/** Discover a companion GNRL BA2 next to the plugin (Main, Interface, or stem.ba2). */
export const discoverCompanionBa2 = (modPath: string, game: GameType = 'fo4'): string | null => {
  const dir = path.dirname(modPath);
  const stem = path.basename(modPath, path.extname(modPath)).toLowerCase();
  const baseStem = path.basename(modPath, path.extname(modPath));
  const suffixes: Array<{ fileSuffix: string }> =
    game === 'fo4' || game === 'fo76'
      ? [{ fileSuffix: ' - Interface' }, { fileSuffix: ' - Main' }, { fileSuffix: '' }]
      : [{ fileSuffix: ' - Main' }, { fileSuffix: '' }];

  for (const { fileSuffix } of suffixes) {
    const candidate = fileSuffix ? `${baseStem}${fileSuffix}.ba2` : `${baseStem}.ba2`;
    const full = path.join(dir, candidate);
    if (fs.existsSync(full)) return full;
  }

  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.toLowerCase().endsWith('.ba2')) continue;
      const base = path.basename(file, '.ba2').toLowerCase();
      if (base === stem || base.startsWith(`${stem} -`)) {
        return path.join(dir, file);
      }
    }
  } catch {
    return null;
  }

  return null;
};

/**
 * Resolve the BA2/BSA file name that should hold localized STRINGS tables.
 *
 * Prefers the import manifest provenance (e.g. vanilla `Fallout4 - Interface.ba2`),
 * then an existing companion archive on disk, then Creation Kit defaults.
 */
export const resolveStringsArchiveFileName = (
  modPath: string,
  pluginStem: string,
  game: GameType,
): string => {
  const extractRoot = resolveModImportExtractRoot(modPath);
  if (extractRoot) {
    const manifest = readModImportExtractManifest(extractRoot);
    if (manifest) {
      for (const [loosePath, provenance] of Object.entries(manifest.files)) {
        const normalized = loosePath.replace(/\\/g, '/');
        if (!STRINGS_LOOSE_RE.test(normalized)) continue;
        if (provenance.packing === 'ba2' || provenance.packing === 'bsa') {
          return path.basename(provenance.sourceArchiveRelativePath.replace(/\\/g, '/'));
        }
      }
    }
  }

  if (usesBa2Archives(game)) {
    const discovered = discoverCompanionBa2(modPath, game);
    if (discovered) return path.basename(discovered);
  }

  return defaultArchiveFileName(pluginStem, game);
};

/** PEX scripts belong in Main.ba2 when string tables ship in Interface.ba2. */
export const resolveScriptsArchiveFileName = (
  pluginStem: string,
  stringsArchiveFileName: string,
  game: GameType,
): string => {
  if (!usesBa2Archives(game)) return stringsArchiveFileName;
  if (stringsArchiveFileName.toLowerCase().includes(' - interface')) {
    return `${pluginStem} - Main.ba2`;
  }
  return stringsArchiveFileName;
};

export const buildArchiveInputFile = (
  archiveType: 'ba2' | 'bsa',
  archiveFileName: string,
  entryPath: string,
  data: Buffer,
  game: GameType,
): ArchiveInputFile => {
  const normalized = entryPath.replace(/\//g, '\\');
  return {
    name: normalized,
    data,
    compressed: shouldCompressArchiveEntry(archiveType, archiveFileName, normalized, game),
  };
};

export type ExportArchiveBuild = {
  fileName: string;
  archiveType: 'ba2' | 'bsa';
  files: ArchiveInputFile[];
};

/** Merge archive entries by output file name. */
export const appendArchiveBuild = (
  builds: Map<string, ExportArchiveBuild>,
  archiveType: 'ba2' | 'bsa',
  fileName: string,
  entries: ArchiveInputFile[],
): void => {
  if (entries.length === 0) return;
  const existing = builds.get(fileName);
  if (existing) {
    existing.files.push(...entries);
    return;
  }
  builds.set(fileName, { fileName, archiveType, files: entries });
};

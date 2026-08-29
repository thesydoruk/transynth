import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import { resolveImportPackages } from '../../modImport/packages';
import { resolveModImportExtractRoot } from '../../modStorage/paths';
import type { GameType } from '../../types';
import {
  loadExportableVoiceKeys,
  voiceKeyFromLocalizedFileName,
} from '../../voice/exportableVoiceKeys';

export type LocalizedVoiceExportEntry = {
  /** Zip/install-relative path with forward slashes (e.g. `Sound/Voice/Mod.esp/00123456_1.fuz`). */
  name: string;
  /** Path relative to the package / localize root (no `Data/` prefix when that is the package). */
  packageRel: string;
  absPath: string;
};

export type CollectLocalizedVoiceOptions = {
  /** File extensions to include (default: `.fuz` only). */
  extensions?: string[];
  /** Rewrite the zip-relative path after the package folder prefix. */
  zipPathTransform?: (relPath: string) => string;
  /** When set, keep only clips whose FormID is in this DB-backed allowlist. */
  exportableKeys?: Set<string>;
  game?: GameType;
};

const normalizeZipPath = (relPath: string): string => relPath.replace(/\\/g, '/');

const matchesExtension = (fileName: string, extensions: string[]): boolean => {
  const lower = fileName.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext.toLowerCase()));
};

const isAllowedVoiceFile = (fileName: string, options: CollectLocalizedVoiceOptions): boolean => {
  if (!options.exportableKeys) return true;
  const key = voiceKeyFromLocalizedFileName(fileName, options.game ?? 'fo4');
  return key != null && options.exportableKeys.has(key);
};

/** Collect synthesized localized voice files from `_localize_{hash}/{lang}/`. */
export const collectLocalizedVoiceFiles = (
  modPath: string,
  targetLang: string,
  options: CollectLocalizedVoiceOptions = {},
): LocalizedVoiceExportEntry[] => {
  const extractRoot = resolveModImportExtractRoot(modPath);
  if (!extractRoot) return [];

  const extensions = options.extensions ?? ['.fuz'];
  const packages = resolveImportPackages(extractRoot, targetLang, modPath);
  const files: LocalizedVoiceExportEntry[] = [];

  for (const pkg of packages) {
    if (!fs.existsSync(pkg.localizeDir)) continue;

    const zipPrefix = pkg.folder ? `${pkg.folder}/` : '';
    const walk = (current: string, relDir: string): void => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full, relPath);
          continue;
        }
        if (!matchesExtension(entry.name, extensions)) continue;
        if (!isAllowedVoiceFile(entry.name, options)) continue;
        const packageRel = normalizeZipPath(relPath);
        const transformed = options.zipPathTransform
          ? options.zipPathTransform(packageRel)
          : normalizeZipPath(`${zipPrefix}${packageRel}`);
        files.push({
          name: normalizeZipPath(transformed),
          packageRel,
          absPath: full,
        });
      }
    };

    walk(pkg.localizeDir, '');
  }

  files.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
  );
  return files;
};

/** Localized voice clips that map to synthesizable database lines. */
export const collectExportableVoiceFiles = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType,
  options: Omit<CollectLocalizedVoiceOptions, 'exportableKeys' | 'game'> = {},
): Promise<LocalizedVoiceExportEntry[]> => {
  const extractRoot = resolveModImportExtractRoot(modPath);
  const exportableKeys = await loadExportableVoiceKeys(
    db,
    modId,
    modPath,
    srcLang,
    targetLang,
    game,
    extractRoot,
  );
  return collectLocalizedVoiceFiles(modPath, targetLang, {
    ...options,
    game,
    exportableKeys,
  });
};

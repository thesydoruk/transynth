import { DEFAULT_GAME_ID, gamePlugin } from '../../games/registry';
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import { resolveImportPackages } from '../../modImport/packages';
import { resolveModImportExtractRoot } from '../../modStorage/paths';
import type { GameId } from '../../types';
import {
  loadExportableVoiceKeys,
  voiceKeyFromLocalizedRelPath,
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
  game?: GameId;
};

const normalizeZipPath = (relPath: string): string => relPath.replace(/\\/g, '/');

const matchesExtension = (fileName: string, extensions: string[]): boolean => {
  const lower = fileName.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext.toLowerCase()));
};

const isAllowedVoiceFile = (relPath: string, options: CollectLocalizedVoiceOptions): boolean => {
  if (!options.exportableKeys) return true;
  const key = voiceKeyFromLocalizedRelPath(relPath, options.game ?? DEFAULT_GAME_ID);
  return key != null && options.exportableKeys.has(key);
};

/**
 * Collect synthesized localized voice files from `_localize_{hash}/{lang}/`.
 *
 * The walk is asynchronous on purpose: a base game holds ~100k takes in
 * thousands of folders on network storage, and a synchronous walk held the
 * worker's event loop past the job lock, so BullMQ declared the export stalled.
 */
export const collectLocalizedVoiceFiles = async (
  modPath: string,
  targetLang: string,
  options: CollectLocalizedVoiceOptions = {},
): Promise<LocalizedVoiceExportEntry[]> => {
  const extractRoot = resolveModImportExtractRoot(modPath);
  if (!extractRoot) return [];

  const extensions = options.extensions ?? [
    gamePlugin(options.game).voice?.sourceExtension ?? '.fuz',
  ];
  const packages = resolveImportPackages(extractRoot, targetLang, modPath);
  const files: LocalizedVoiceExportEntry[] = [];

  for (const pkg of packages) {
    if (!fs.existsSync(pkg.localizeDir)) continue;

    const zipPrefix = pkg.folder ? `${pkg.folder}/` : '';
    const walk = async (current: string, relDir: string): Promise<void> => {
      for (const entry of await fs.promises.readdir(current, { withFileTypes: true })) {
        const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(full, relPath);
          continue;
        }
        if (!matchesExtension(entry.name, extensions)) continue;
        if (!isAllowedVoiceFile(relPath, options)) continue;
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

    await walk(pkg.localizeDir, '');
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
  game: GameId,
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

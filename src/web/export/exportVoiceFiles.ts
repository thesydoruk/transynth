import { DEFAULT_GAME_ID, gamePlugin } from '../../games/registry';
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import { resolveImportPackages } from '../../modImport/packages';
import { resolveModImportExtractRoot } from '../../modStorage/paths';
import type { GameId } from '../../types';
import { loadExportableVoiceKeys } from '../../voice/exportableVoiceKeys';
import { voiceTakeKeyResolver } from '../../voice/takeFormat';

export type LocalizedVoiceExportEntry = {
  /** Zip/install-relative path with forward slashes (e.g. `Sound/Voice/Mod.esp/Npc/00123456_1.fuz`). */
  name: string;
  /** Path relative to the package / localize root (no `Data/` prefix when that is the package). */
  packageRel: string;
  absPath: string;
};

export type CollectLocalizedVoiceOptions = {
  /** File extensions to include (default: {@link localizedVoiceExtensions} of the game). */
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

/**
 * Extensions of the files a game's localized takes are made of: the take
 * itself and whatever travels with it — Starfield ships a `.ffxanim` beside
 * every `.wem`, and a pack with only one of the two is a pack of broken takes.
 */
export const localizedVoiceExtensions = (game: GameId | undefined): string[] => {
  const voice = gamePlugin(game).voice;
  return [voice?.sourceExtension ?? '.fuz', ...(voice?.takes?.sidecarExtensions ?? [])];
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

  const extensions = options.extensions ?? localizedVoiceExtensions(options.game);
  const voice = gamePlugin(options.game ?? DEFAULT_GAME_ID).voice;
  const packages = resolveImportPackages(extractRoot, targetLang, modPath);
  const files: LocalizedVoiceExportEntry[] = [];

  for (const pkg of packages) {
    if (!fs.existsSync(pkg.localizeDir)) continue;

    // A take's key may only be readable against the package's own plugin.
    const keyOf = voice ? voiceTakeKeyResolver(voice, pkg.pluginPath) : () => null;
    const isAllowedVoiceFile = (relPath: string): boolean => {
      if (!options.exportableKeys) return true;
      const key = keyOf(relPath);
      return key != null && options.exportableKeys.has(key);
    };

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
        if (!isAllowedVoiceFile(relPath)) continue;
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

import fs from 'node:fs';
import path from 'node:path';
import { resolveModDirectoryFromPath } from '../formats/mcm';
import { filterPrimaryPlugins } from '../import/mod/importAnchor';
import { gamePlugin, resolveGameId } from '../games/registry';
import type { GameId } from '../types';
import { discoverModFiles } from '../import/mod';
import { modImportLocalizeDir } from '../modStorage';
import { ensureDir } from '../utils/file';

export type ImportPackageContext = {
  folder: string;
  packageDir: string;
  pluginPath: string;
  localizeDir: string;
};

const packageContextForAnchor = (
  extractDir: string,
  localizeRoot: string,
  anchorPath: string,
): ImportPackageContext => {
  // Disco Final Cut packs: keep the whole extract tree as the package root so
  // Audio/ and language folders resolve consistently for voice + export.
  if (anchorPath.toLowerCase().endsWith('.po')) {
    return {
      folder: '',
      packageDir: extractDir,
      pluginPath: path.resolve(anchorPath),
      localizeDir: localizeRoot,
    };
  }

  const packageDir = resolveModDirectoryFromPath(anchorPath);
  const folder = path.relative(extractDir, packageDir);
  const normalizedFolder = folder === '.' ? '' : folder.replace(/\\/g, '/');
  return {
    folder: normalizedFolder,
    packageDir,
    pluginPath: path.resolve(anchorPath),
    localizeDir: normalizedFolder ? path.join(localizeRoot, normalizedFolder) : localizeRoot,
  };
};

const normalizeRelPath = (relPath: string): string => relPath.replace(/\\/g, '/');

/** Plugin path relative to the package root (e.g. `Data/Mod.esp`). */
export const pluginRelPath = (packageDir: string, pluginPath: string): string =>
  normalizeRelPath(path.relative(packageDir, pluginPath));

/**
 * Resolve archive-relative asset paths next to the plugin (Scripts/, Strings/, Sound/, …).
 * Keeps localized deltas mirroring the extract tree (e.g. `Data/Scripts/Foo.pex`, not `Scripts/Foo.pex`).
 */
export const pluginSiblingRelPath = (
  packageDir: string,
  pluginPath: string,
  siblingRel: string,
): string => {
  const pluginDir = path.dirname(pluginRelPath(packageDir, pluginPath));
  const sibling = normalizeRelPath(siblingRel);
  return pluginDir === '.' ? sibling : normalizeRelPath(path.join(pluginDir, sibling));
};

/** Join a normalized relative path under a root directory. */
export const toDiskPath = (rootDir: string, relPath: string): string => {
  const parts = normalizeRelPath(relPath).split('/').filter(Boolean);
  return path.join(rootDir, ...parts);
};

/** Write `data` when it differs from `baselinePath` (or baseline is missing). */
export const writeIfChanged = (
  destPath: string,
  data: Buffer,
  baselinePath: string | null,
): boolean => {
  if (baselinePath && fs.existsSync(baselinePath)) {
    const { size } = fs.statSync(baselinePath);
    if (size === data.length) {
      const baseline = fs.readFileSync(baselinePath);
      if (baseline.equals(data)) return false;
    }
  }

  ensureDir(path.dirname(destPath));
  fs.writeFileSync(destPath, data);
  return true;
};

/** Resolve one or more plugin packages inside a mod import extract tree. */
export const resolveImportPackages = (
  extractDir: string,
  lang: string,
  primaryPluginPath?: string,
  /**
   * Only consulted when `primaryPluginPath` is omitted: the anchor then has to
   * be discovered, and which file counts as one is the game's own business.
   */
  game?: GameId | null,
): ImportPackageContext[] => {
  const resolvedExtractDir = path.resolve(extractDir);
  const localizeRoot = modImportLocalizeDir(resolvedExtractDir, lang);

  if (!fs.existsSync(resolvedExtractDir)) {
    throw new Error(`Import extract directory not found: ${resolvedExtractDir}`);
  }

  if (primaryPluginPath) {
    return [packageContextForAnchor(resolvedExtractDir, localizeRoot, primaryPluginPath)];
  }

  const plugins = filterPrimaryPlugins(discoverModFiles(resolvedExtractDir).plugins);
  if (plugins.length === 0) {
    // Nothing this code recognizes as a plugin, so ask the game what its own
    // uploads are anchored to — a `.po` pack, an MCM translation file, or
    // whatever the next engine ships. Guessing a game here would pick the
    // wrong answer silently, so a caller that needs the fallback must say.
    if (game == null) {
      throw new Error(
        `No plugin found under ${resolvedExtractDir}; pass a game to resolve the anchor`,
      );
    }
    const anchor = gamePlugin(game).import.selectAnchor(resolvedExtractDir);
    if (anchor) return [packageContextForAnchor(resolvedExtractDir, localizeRoot, anchor)];
    throw new Error(
      `Nothing importable for ${resolveGameId(game)} found under ${resolvedExtractDir}`,
    );
  }

  const packageDirs = new Map<string, string>();
  for (const plugin of plugins) {
    const packageDir = resolveModDirectoryFromPath(plugin);
    const relDir = path.relative(resolvedExtractDir, packageDir);
    const folder = relDir === '.' ? '' : relDir.replace(/\\/g, '/');
    if (!packageDirs.has(folder)) packageDirs.set(folder, plugin);
  }

  return [...packageDirs.values()].map((pluginPath) =>
    packageContextForAnchor(resolvedExtractDir, localizeRoot, pluginPath),
  );
};

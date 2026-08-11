import fs from 'node:fs';
import path from 'node:path';
import {
  findFirstMcmTranslationFile,
  hasMcmTranslationFiles,
  resolveModDirectoryFromPath,
} from '../formats/mcm';
import { filterPrimaryPlugins } from '../import/mod/importAnchor';
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
    const baseline = fs.readFileSync(baselinePath);
    if (baseline.equals(data)) return false;
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
    if (hasMcmTranslationFiles(resolvedExtractDir)) {
      const anchor = findFirstMcmTranslationFile(resolvedExtractDir);
      if (anchor) return [packageContextForAnchor(resolvedExtractDir, localizeRoot, anchor)];
    }
    throw new Error(`No plugins or MCM translation files found under ${resolvedExtractDir}`);
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

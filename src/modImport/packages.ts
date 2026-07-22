import fs from 'node:fs';
import path from 'node:path';
import { modImportLocalizeDir } from '../modStorage';
import { ensureDir } from '../utils/file';
import { discoverModFiles } from '../web/import/modImportService';

export type ImportPackageContext = {
  folder: string;
  packageDir: string;
  pluginPath: string;
  localizeDir: string;
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
    const pluginPath = path.resolve(primaryPluginPath);
    const folder = path.relative(resolvedExtractDir, path.dirname(pluginPath));
    const normalizedFolder = folder === '.' ? '' : folder.replace(/\\/g, '/');
    return [
      {
        folder: normalizedFolder,
        packageDir: path.dirname(pluginPath),
        pluginPath,
        localizeDir: normalizedFolder ? path.join(localizeRoot, normalizedFolder) : localizeRoot,
      },
    ];
  }

  const plugins = discoverModFiles(resolvedExtractDir).plugins;
  if (plugins.length === 0) {
    throw new Error(`No plugins found under ${resolvedExtractDir}`);
  }

  const pluginDirs = new Map<string, string>();
  for (const plugin of plugins) {
    const relDir = path.relative(resolvedExtractDir, path.dirname(plugin));
    const folder = relDir === '.' ? '' : relDir.replace(/\\/g, '/');
    if (!pluginDirs.has(folder)) pluginDirs.set(folder, plugin);
  }

  return [...pluginDirs.entries()].map(([folder, pluginPath]) => ({
    folder,
    packageDir: folder ? path.join(resolvedExtractDir, folder) : resolvedExtractDir,
    pluginPath,
    localizeDir: folder ? path.join(localizeRoot, folder) : localizeRoot,
  }));
};

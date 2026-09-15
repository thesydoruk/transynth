import fs from 'node:fs';
import path from 'node:path';
import { isSecondaryPluginPath } from '../import/mod/importAnchor';
import { isPlugin } from '../import/mod/discovery';
import type { VortexInventoryFile } from './types';
import { toPosixRel } from './hashSubset';
import { isVortexSyncFile, shouldSkipVortexWalkDir } from './syncWorthy';

const walkLoose = (root: string, current: string, out: string[]): void => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipVortexWalkDir(root, full, entry.name)) continue;
      walkLoose(root, full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (isSecondaryPluginPath(full)) continue;
    const relPath = toPosixRel(root, full);
    if (isVortexSyncFile(full, entry.name, relPath)) out.push(full);
  }
};

const listTranslatableFiles = (root: string): string[] => {
  const files: string[] = [];
  walkLoose(root, root, files);
  return files;
};

export const collectPluginUnitFiles = (
  folderRoot: string,
  pluginPath: string | null,
): VortexInventoryFile[] => {
  const all = listTranslatableFiles(folderRoot);
  const stem = pluginPath
    ? path.basename(pluginPath, path.extname(pluginPath)).toLowerCase()
    : null;

  const picked = all.filter((absPath) => {
    const base = path.basename(absPath).toLowerCase();
    const ext = path.extname(base);
    if (pluginPath && path.resolve(absPath) === path.resolve(pluginPath)) return true;
    if (!stem) return true;
    if (ext === '.ba2' || ext === '.bsa') return base.startsWith(stem);
    if (isPlugin(base) && path.resolve(absPath) !== path.resolve(pluginPath ?? '')) return false;
    return true;
  });

  return picked.map((absPath) => ({
    absPath,
    relPath: toPosixRel(folderRoot, absPath),
  }));
};

export const collectNamedPluginFiles = (
  dataDir: string,
  pluginFileName: string,
): VortexInventoryFile[] => {
  const pluginPath = path.join(dataDir, pluginFileName);
  if (!fs.existsSync(pluginPath)) return [];
  const stem = path.basename(pluginFileName, path.extname(pluginFileName)).toLowerCase();
  const files: VortexInventoryFile[] = [{ absPath: pluginPath, relPath: pluginFileName }];

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dataDir);
  } catch {
    return files;
  }

  for (const name of entries) {
    const full = path.join(dataDir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const lower = name.toLowerCase();
    const ext = path.extname(lower);
    if (
      (ext === '.ba2' || ext === '.bsa') &&
      lower.startsWith(stem) &&
      isVortexSyncFile(full, name)
    ) {
      files.push({ absPath: full, relPath: name });
    }
  }

  const stringsDir = path.join(dataDir, 'Strings');
  if (fs.existsSync(stringsDir)) {
    for (const name of fs.readdirSync(stringsDir)) {
      if (name.toLowerCase().startsWith(stem)) {
        files.push({
          absPath: path.join(stringsDir, name),
          relPath: `Strings/${name}`,
        });
      }
    }
  }

  return files;
};

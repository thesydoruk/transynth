import fs from 'node:fs';
import path from 'node:path';
import { isSecondaryPluginPath } from '../import/mod/importAnchor';
import type { VortexInventoryFile } from './types';
import { toPosixRel } from './hashSubset';
import {
  isVortexSyncFile,
  shouldSkipVortexWalkDir,
  type VortexSyncFileOptions,
} from './syncWorthy';
import { isVideoFileName } from './videoFiles';

const walkLoose = (
  root: string,
  current: string,
  out: string[],
  options: VortexSyncFileOptions,
): void => {
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
      walkLoose(root, full, out, options);
      continue;
    }
    if (!entry.isFile()) continue;
    if (isSecondaryPluginPath(full)) continue;
    const relPath = toPosixRel(root, full);
    if (isVortexSyncFile(full, entry.name, relPath, options)) out.push(full);
  }
};

const listTranslatableFiles = (root: string, options: VortexSyncFileOptions): string[] => {
  const files: string[] = [];
  walkLoose(root, root, files, options);
  return files;
};

/**
 * Everything a Vortex mod folder ships that the server can translate: every
 * plugin (not the installer's optional copies), every text-bearing archive and
 * the loose text. One folder is one upload, unpacked once on the server, where
 * each plugin then becomes its own mod.
 */
export const collectFolderUnitFiles = (
  folderRoot: string,
  options: VortexSyncFileOptions = {},
): VortexInventoryFile[] =>
  listTranslatableFiles(folderRoot, options).map((absPath) => ({
    absPath,
    relPath: toPosixRel(folderRoot, absPath),
  }));

/**
 * The game's own files of one official plugin: the plugin, its archives, its
 * string tables and — for the main master, which owns everything no plugin
 * claims — the cutscene videos.
 */
export const collectNamedPluginFiles = (
  dataDir: string,
  pluginFileName: string,
  options: VortexSyncFileOptions = {},
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

  if (options.videos) {
    const videoDir = path.join(dataDir, 'Video');
    if (fs.existsSync(videoDir)) {
      for (const name of fs.readdirSync(videoDir).sort((a, b) => a.localeCompare(b, 'en'))) {
        const full = path.join(videoDir, name);
        if (isVideoFileName(name) && fs.statSync(full).isFile()) {
          files.push({ absPath: full, relPath: `Video/${name}` });
        }
      }
    }
  }

  return files;
};

import fs from 'node:fs';
import path from 'node:path';
import type { ArchiveInputFile } from '../formats/types';
import type { GameType } from '../types';
import { defaultArchiveFileName, usesBa2Archives } from '../formats/ba2';

/** Top-level folders that are normally stored inside BA2/BSA archives. */
export const ARCHIVE_TOP_DIRS = new Set([
  'strings',
  'scripts',
  'meshes',
  'materials',
  'textures',
  'sound',
  'sounds',
  'voice',
  'voices',
  'music',
  'interface',
  'tools',
  'shaders',
  'misc',
  'programs',
  'fonts',
  'seq',
  'vis',
  'lodsettings',
  'gamedata',
]);

export const isBethesdaArchiveFile = (fileName: string): boolean => {
  const ext = path.extname(fileName).toLowerCase();
  return ext === '.ba2' || ext === '.bsa';
};

export const toArchiveRelativePath = (rootDir: string, filePath: string): string =>
  path.relative(rootDir, filePath).replace(/\//g, '\\');

export const archiveEntryToDiskPath = (rootDir: string, entryName: string): string => {
  const parts = entryName.replace(/\\/g, '/').split('/').filter(Boolean);
  return path.join(rootDir, ...parts);
};

export const normalizeArchivePath = (entryName: string): string =>
  entryName.replace(/\\/g, '/').toLowerCase();

export const bsaVersionForGame = (game: GameType): number => (game === 'sse' ? 105 : 104);

export { defaultArchiveFileName, usesBa2Archives };

export const defaultArchiveType = (game: GameType): 'ba2' | 'bsa' =>
  usesBa2Archives(game) ? 'ba2' : 'bsa';

const walkFiles = (dir: string, out: string[]): void => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
};

/** Collect loose files under archive-style top-level folders. */
export const collectArchiveableLooseFiles = (packageDir: string): ArchiveInputFile[] => {
  const files: ArchiveInputFile[] = [];

  for (const entry of fs.readdirSync(packageDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!ARCHIVE_TOP_DIRS.has(entry.name.toLowerCase())) continue;

    const topDir = path.join(packageDir, entry.name);
    const diskFiles: string[] = [];
    walkFiles(topDir, diskFiles);
    for (const diskPath of diskFiles) {
      files.push({
        name: toArchiveRelativePath(packageDir, diskPath),
        data: fs.readFileSync(diskPath),
      });
    }
  }

  return files;
};

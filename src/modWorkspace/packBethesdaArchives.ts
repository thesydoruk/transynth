import fs from 'node:fs';
import path from 'node:path';
import { writeBa2 } from '../formats/ba2';
import { writeBsa } from '../formats/bsa';
import type { ArchiveInputFile } from '../formats/types';
import { log } from '../logger';
import type { GameType } from '../types';
import type { ArchiveManifestEntry } from './archiveManifest';
import {
  archiveEntryToDiskPath,
  bsaVersionForGame,
  collectArchiveableLooseFiles,
  defaultArchiveFileName,
  defaultArchiveType,
  normalizeArchivePath,
  toArchiveRelativePath,
} from './bethesdaArchivePaths';
import { isRepackableBethesdaArchive, shouldCompressArchiveEntry } from './creationKitArchiveRules';

export type PackedBethesdaArchive = {
  fileName: string;
  destPath: string;
  entryCount: number;
};

const walkFiles = (dir: string, out: string[]): void => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
};

/**
 * Refresh archive entry list from disk: keep manifest folders and include new/edited files.
 */
export const refreshArchiveEntryPaths = (
  packageDir: string,
  archive: ArchiveManifestEntry,
): string[] => {
  if (archive.entries.length === 0) return [];

  const paths = new Map<string, string>();
  const walkedDirs = new Set<string>();

  for (const entry of archive.entries) {
    paths.set(normalizeArchivePath(entry), entry);
  }

  for (const entry of archive.entries) {
    const diskFile = archiveEntryToDiskPath(packageDir, entry);
    const diskDir = path.dirname(diskFile);
    const walkKey = diskDir.toLowerCase();
    if (walkedDirs.has(walkKey) || !fs.existsSync(diskDir)) continue;
    walkedDirs.add(walkKey);

    const files: string[] = [];
    walkFiles(diskDir, files);
    for (const filePath of files) {
      const rel = toArchiveRelativePath(packageDir, filePath);
      paths.set(normalizeArchivePath(rel), rel);
    }
  }

  return [...paths.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
};

export const collectArchiveInputFiles = (
  rootDir: string,
  entries: string[],
  archive: ArchiveManifestEntry,
  game: GameType,
): ArchiveInputFile[] => {
  const files: ArchiveInputFile[] = [];
  for (const entryName of entries) {
    const diskPath = archiveEntryToDiskPath(rootDir, entryName);
    if (!fs.existsSync(diskPath)) {
      throw new Error(`Missing file for archive entry "${entryName}" in ${rootDir}`);
    }
    const normalized = entryName.replace(/\//g, '\\');
    files.push({
      name: normalized,
      data: fs.readFileSync(diskPath),
      compressed: shouldCompressArchiveEntry(archive.type, archive.fileName, normalized, game),
    });
  }
  return files;
};

export const writeBethesdaArchiveFile = (
  destPath: string,
  archive: ArchiveManifestEntry,
  files: ArchiveInputFile[],
  game: GameType,
): void => {
  if (files.length === 0) {
    throw new Error(`Cannot write empty archive ${archive.fileName}`);
  }

  const buf =
    archive.type === 'ba2'
      ? writeBa2(files)
      : writeBsa(files, archive.bsaVersion ?? bsaVersionForGame(game));

  fs.writeFileSync(destPath, buf);
};

export const inferArchivesForPackage = (
  packageDir: string,
  pluginFiles: string[],
  game: GameType,
): ArchiveManifestEntry[] => {
  const looseFiles = collectArchiveableLooseFiles(packageDir);
  if (looseFiles.length === 0) return [];

  const pluginStem = pluginFiles[0]
    ? path.basename(pluginFiles[0], path.extname(pluginFiles[0]))
    : 'mod';

  const archiveType = defaultArchiveType(game);
  return [
    {
      type: archiveType,
      fileName: defaultArchiveFileName(pluginStem, game),
      entries: looseFiles.map((file) => file.name),
      ...(archiveType === 'bsa' ? { bsaVersion: bsaVersionForGame(game) } : {}),
    },
  ];
};

export const resolvePackageArchives = (
  packageDir: string,
  archives: ArchiveManifestEntry[],
  pluginFiles: string[],
  game: GameType,
): ArchiveManifestEntry[] => {
  const resolved =
    archives.length > 0 ? archives : inferArchivesForPackage(packageDir, pluginFiles, game);

  return resolved.map((archive) => ({
    ...archive,
    entries: refreshArchiveEntryPaths(packageDir, archive),
  }));
};

/** Pack BA2/BSA archives into `destDir` from loose files in `packageDir`. */
export const packBethesdaArchivesIntoDir = (
  packageDir: string,
  destDir: string,
  archives: ArchiveManifestEntry[],
  pluginFiles: string[],
  game: GameType,
): PackedBethesdaArchive[] => {
  const resolved = resolvePackageArchives(packageDir, archives, pluginFiles, game);
  const packed: PackedBethesdaArchive[] = [];

  for (const archive of resolved) {
    if (archive.entries.length === 0) continue;
    if (!isRepackableBethesdaArchive(archive.type, archive.fileName, game)) {
      log.info(`  skip repack ${archive.fileName} (DX10 / pass-through)`);
      continue;
    }

    const files = collectArchiveInputFiles(packageDir, archive.entries, archive, game);
    const destPath = path.join(destDir, archive.fileName);
    writeBethesdaArchiveFile(destPath, archive, files, game);
    packed.push({ fileName: archive.fileName, destPath, entryCount: files.length });
    log.info(`  packed ${archive.fileName} (${files.length} file(s))`);
  }

  return packed;
};

export const manifestArchivedPaths = (archives: ArchiveManifestEntry[]): Set<string> => {
  const paths = new Set<string>();
  for (const archive of archives) {
    for (const entry of archive.entries) {
      paths.add(normalizeArchivePath(entry));
    }
  }
  return paths;
};

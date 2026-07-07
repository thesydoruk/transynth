import fs from 'node:fs';
import path from 'node:path';
import { Ba2Reader } from '../formats/ba2';
import { isBa2GnrArchive } from '../formats/ba2/readBa2ArchiveType';
import { BsaReader } from '../formats/bsa';
import { log } from '../logger';
import { ensureDir } from '../utils/file';
import type { ArchiveManifestEntry } from './archiveManifest';

export const listBa2ArchiveEntries = (archivePath: string): string[] => {
  const reader = new Ba2Reader(archivePath);
  try {
    return reader.listFiles();
  } finally {
    reader.close();
  }
};

export const listBsaArchiveEntries = (archivePath: string): string[] => {
  const reader = new BsaReader(archivePath);
  return reader.list().map((entry) => entry.name);
};

/** Extract a GNRL BA2 archive into `outDir`, preserving internal paths. */
export const extractBa2ToDir = (archivePath: string, outDir: string): void => {
  if (!isBa2GnrArchive(archivePath)) {
    log.warn(`Skipping non-GNRL BA2: ${path.basename(archivePath)}`);
    return;
  }

  const reader = new Ba2Reader(archivePath);
  try {
    for (const name of reader.listFiles()) {
      const dest = path.join(outDir, name);
      ensureDir(path.dirname(dest));
      const data = reader.extractByName(name);
      if (!data) continue;
      fs.writeFileSync(dest, data);
    }
  } finally {
    reader.close();
  }
};

/** Extract a BSA archive into `outDir`, preserving internal paths. */
export const extractBsaToDir = (archivePath: string, outDir: string): void => {
  const reader = new BsaReader(archivePath);
  for (const entry of reader.list()) {
    const dest = path.join(outDir, entry.name);
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, reader.extractEntry(entry));
  }
};

/**
 * Extract a BA2/BSA archive next to itself, remove the archive file, and return manifest metadata.
 */
export const extractBethesdaArchiveInPlace = (archivePath: string): ArchiveManifestEntry | null => {
  const ext = path.extname(archivePath).toLowerCase();
  const fileName = path.basename(archivePath);
  const outDir = path.dirname(archivePath);

  if (ext === '.ba2') {
    if (!isBa2GnrArchive(archivePath)) {
      log.warn(`Skipping non-GNRL BA2: ${fileName}`);
      return null;
    }
    const entries = listBa2ArchiveEntries(archivePath);
    extractBa2ToDir(archivePath, outDir);
    fs.unlinkSync(archivePath);
    log.debug(`Extracted and removed ${fileName}`);
    return { type: 'ba2', fileName, entries };
  }

  if (ext === '.bsa') {
    const entries = listBsaArchiveEntries(archivePath);
    extractBsaToDir(archivePath, outDir);
    fs.unlinkSync(archivePath);
    log.debug(`Extracted and removed ${fileName}`);
    return { type: 'bsa', fileName, entries };
  }

  return null;
};

const walkBethesdaArchives = (dir: string, out: string[]): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkBethesdaArchives(full, out);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (ext === '.ba2' || ext === '.bsa') out.push(full);
  }
  return out;
};

/** Extract every BA2/BSA under `root` in place (deepest archives first). */
export const extractAllBethesdaArchivesInTree = (root: string): ArchiveManifestEntry[] => {
  const archives = walkBethesdaArchives(root, []);
  archives.sort((a, b) => b.length - a.length);
  const manifest: ArchiveManifestEntry[] = [];
  for (const archivePath of archives) {
    if (!fs.existsSync(archivePath)) continue;
    const entry = extractBethesdaArchiveInPlace(archivePath);
    if (entry) manifest.push(entry);
  }
  return manifest;
};

import fs from 'node:fs';
import path from 'node:path';
import { Ba2Reader } from '../formats/ba2';
import { isBa2GnrArchive, readBa2ArchiveType } from '../formats/ba2/readBa2ArchiveType';
import { BsaReader } from '../formats/bsa';
import { log } from '../logger';
import { ensureDir } from '../utils/file';
import type {
  ArchiveManifestEntry,
  ModImportArchiveRecord,
  ModImportFileProvenance,
} from './archiveManifest';

const normalizeEntryPath = (entryPath: string): string => entryPath.replace(/\\/g, '/');

const relativeFromRoot = (extractRoot: string, absPath: string): string =>
  normalizeEntryPath(path.relative(extractRoot, absPath));

/** Map an archive-internal path to a safe on-disk path under `outDir`. */
const archiveEntryPathToDisk = (outDir: string, entryName: string): string =>
  path.join(outDir, ...entryName.split(/[/\\]/).filter(Boolean));

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
    for (const entry of reader.listEntries()) {
      const dest = archiveEntryPathToDisk(outDir, entry.name);
      ensureDir(path.dirname(dest));
      fs.writeFileSync(dest, reader.extractEntry(entry));
    }
  } finally {
    reader.close();
  }
};

/** Extract a BSA archive into `outDir`, preserving internal paths. */
export const extractBsaToDir = (archivePath: string, outDir: string): void => {
  const reader = new BsaReader(archivePath);
  for (const entry of reader.list()) {
    const dest = archiveEntryPathToDisk(outDir, entry.name);
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, reader.extractEntry(entry));
  }
};

export type BethesdaExtractWithManifestResult = {
  archive: ModImportArchiveRecord;
  fileProvenance: ModImportFileProvenance[];
};

/**
 * Extract a BA2/BSA archive next to itself, remove the archive file, and return manifest metadata.
 */
export const extractBethesdaArchiveInPlace = (archivePath: string): ArchiveManifestEntry | null => {
  const result = extractBethesdaArchiveInPlaceWithManifest(archivePath, path.dirname(archivePath));
  if (!result) return null;
  const { archive } = result;
  return {
    type: archive.packing,
    fileName: archive.fileName,
    entries: archive.entries,
    bsaVersion: archive.bsaVersion,
  };
};

/**
 * Like {@link extractBethesdaArchiveInPlace} but also records per-file provenance relative to
 * `extractRoot`.
 */
export const extractBethesdaArchiveInPlaceWithManifest = (
  archivePath: string,
  extractRoot: string,
): BethesdaExtractWithManifestResult | null => {
  const ext = path.extname(archivePath).toLowerCase();
  const fileName = path.basename(archivePath);
  const archiveRelativePath = relativeFromRoot(extractRoot, archivePath);
  const outDir = path.dirname(archivePath);

  if (ext === '.ba2') {
    const ba2Type = readBa2ArchiveType(archivePath);
    if (!isBa2GnrArchive(archivePath)) {
      log.warn(`Skipping non-GNRL BA2: ${fileName}`);
      return {
        archive: {
          fileName,
          relativePath: archiveRelativePath,
          packing: 'ba2',
          extracted: false,
          skipReason: ba2Type ? `unsupported BA2 type ${ba2Type}` : 'invalid BA2 archive',
          entries: [],
          ba2Type,
        },
        fileProvenance: [],
      };
    }

    const entries = listBa2ArchiveEntries(archivePath);
    extractBa2ToDir(archivePath, outDir);
    fs.unlinkSync(archivePath);
    log.debug(`Extracted and removed ${fileName}`);

    const fileProvenance: ModImportFileProvenance[] = entries.map((entryPath) => ({
      sourceArchiveRelativePath: archiveRelativePath,
      entryPath: normalizeEntryPath(entryPath),
      packing: 'ba2',
    }));

    return {
      archive: {
        fileName,
        relativePath: archiveRelativePath,
        packing: 'ba2',
        extracted: true,
        entries: entries.map(normalizeEntryPath),
        ba2Type,
      },
      fileProvenance,
    };
  }

  if (ext === '.bsa') {
    const reader = new BsaReader(archivePath);
    const entries = reader.list().map((entry) => entry.name);
    const bsaVersion = reader.version;
    extractBsaToDir(archivePath, outDir);
    fs.unlinkSync(archivePath);
    log.debug(`Extracted and removed ${fileName}`);

    const fileProvenance = entries.map((entryPath) => ({
      sourceArchiveRelativePath: archiveRelativePath,
      entryPath: normalizeEntryPath(entryPath),
      packing: 'bsa' as const,
    }));

    return {
      archive: {
        fileName,
        relativePath: archiveRelativePath,
        packing: 'bsa',
        extracted: true,
        entries: entries.map(normalizeEntryPath),
        bsaVersion,
      },
      fileProvenance,
    };
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

const collectBethesdaArchivesInDirs = (dirs: string[]): string[] => {
  const archives = new Set<string>();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const archivePath of walkBethesdaArchives(dir, [])) {
      archives.add(archivePath);
    }
  }
  return [...archives];
};

/** Extract every BA2/BSA under `root` in place (deepest archives first). */
export const extractAllBethesdaArchivesInTree = (root: string): ArchiveManifestEntry[] => {
  const result = extractAllBethesdaArchivesInTreeWithManifest(root);
  return result.archives
    .filter((archive) => archive.extracted)
    .map((archive) => ({
      type: archive.packing,
      fileName: archive.fileName,
      entries: archive.entries,
      bsaVersion: archive.bsaVersion,
    }));
};

/** Extract every BA2/BSA under `root` and build a provenance manifest. */
export const extractAllBethesdaArchivesInTreeWithManifest = (
  root: string,
  scopeDirs: string[] = [root],
): {
  archives: ModImportArchiveRecord[];
  files: Record<string, ModImportFileProvenance>;
} => {
  const archives = collectBethesdaArchivesInDirs(scopeDirs);
  archives.sort((a, b) => b.length - a.length);

  const archiveRecords: ModImportArchiveRecord[] = [];
  const files: Record<string, ModImportFileProvenance> = {};

  for (const archivePath of archives) {
    if (!fs.existsSync(archivePath)) continue;
    const result = extractBethesdaArchiveInPlaceWithManifest(archivePath, root);
    if (!result) continue;
    archiveRecords.push(result.archive);
    for (const provenance of result.fileProvenance) {
      const looseRelativePath = relativeFromRoot(
        root,
        path.join(path.dirname(archivePath), provenance.entryPath),
      );
      files[looseRelativePath] = provenance;
    }
  }

  return { archives: archiveRecords, files };
};

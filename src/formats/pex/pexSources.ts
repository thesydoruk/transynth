/**
 * Discover compiled Papyrus scripts (.pex) next to a mod plugin.
 *
 * Mirrors the import-side PEX scan: GNRL BA2 archives first, then loose
 * `Scripts/**.pex` files at any depth (loose wins on name collision). Scripts
 * in a namespace folder are keyed `namespace:name` (see `pexScriptKey`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { BsaReader } from '../bsa';
import { getBa2Reader, isBa2GnrArchive } from '../ba2';
import { parsePexBuffer, pexScriptKeyFromInfo } from './pexParser';
import { listLoosePexFiles, pexScriptKeyFromRelPath } from './pexScriptKey';

export type PexSourceFile = {
  /** Lowercase script key matching DB `PEX\\{key}` record paths. */
  scriptKey: string;
  /** Archive-relative path, e.g. `Scripts\\MyScript.pex`. */
  archivePath: string;
  data: Buffer;
};

const normalizeArchivePath = (entryName: string): string => entryName.replace(/\//g, '\\');

const listGnrBa2FilesInDir = (modDir: string): string[] => {
  try {
    return fs
      .readdirSync(modDir)
      .filter((f) => f.toLowerCase().endsWith('.ba2'))
      .map((f) => path.join(modDir, f))
      .filter(isBa2GnrArchive);
  } catch {
    return [];
  }
};

const listCompanionGnrlBa2ForPlugin = (modPath: string): string[] => {
  const modDir = path.dirname(modPath);
  const stem = path.basename(modPath, path.extname(modPath)).toLowerCase();
  return listGnrBa2FilesInDir(modDir).filter((ba2) => {
    const base = path.basename(ba2, '.ba2').toLowerCase();
    return base.startsWith(stem);
  });
};

const listBsaFilesInDir = (modDir: string): string[] => {
  try {
    return fs
      .readdirSync(modDir)
      .filter((f) => f.toLowerCase().endsWith('.bsa'))
      .map((f) => path.join(modDir, f));
  } catch {
    return [];
  }
};

/** One script buffer → source entry, or null when it does not parse. */
const toPexSource = (archivePath: string, data: Buffer): PexSourceFile | null => {
  try {
    const { info } = parsePexBuffer(data);
    const scriptKey = pexScriptKeyFromRelPath(archivePath, pexScriptKeyFromInfo(info));
    if (!scriptKey) return null;
    return { scriptKey: scriptKey.toLowerCase(), archivePath, data };
  } catch {
    // Skip unreadable entries — export proceeds with whatever parses cleanly.
    return null;
  }
};

type PexArchiveReader = {
  listByExt(ext: string): Array<{ name: string }>;
  extractEntry(entry: { name: string }): Buffer;
};

const loadPexFromArchive = (reader: PexArchiveReader): PexSourceFile[] => {
  const result: PexSourceFile[] = [];
  for (const entry of reader.listByExt('pex')) {
    let data: Buffer;
    try {
      data = reader.extractEntry(entry);
    } catch {
      continue;
    }
    const source = toPexSource(normalizeArchivePath(entry.name), data);
    if (source) result.push(source);
  }
  return result;
};

const loadPexFromLooseFiles = (modDir: string): PexSourceFile[] => {
  const result: PexSourceFile[] = [];
  for (const file of listLoosePexFiles(modDir)) {
    let data: Buffer;
    try {
      data = fs.readFileSync(file.absPath);
    } catch {
      continue;
    }
    const source = toPexSource(file.archivePath, data);
    if (source) result.push(source);
  }
  return result;
};

/**
 * Collect all `.pex` sources for a plugin, keyed by script name.
 *
 * @param modPath - Absolute path to the mod plugin (.esp/.esm/.esl).
 */
export const collectModPexSources = (modPath: string): Map<string, PexSourceFile> => {
  const modDir = path.dirname(modPath);
  const merged = new Map<string, PexSourceFile>();

  for (const ba2Path of listCompanionGnrlBa2ForPlugin(modPath)) {
    for (const source of loadPexFromArchive(getBa2Reader(ba2Path))) {
      if (!merged.has(source.scriptKey)) merged.set(source.scriptKey, source);
    }
  }

  for (const bsaPath of listBsaFilesInDir(modDir)) {
    for (const source of loadPexFromArchive(new BsaReader(bsaPath))) {
      if (!merged.has(source.scriptKey)) merged.set(source.scriptKey, source);
    }
  }

  for (const source of loadPexFromLooseFiles(modDir)) {
    merged.set(source.scriptKey, source);
  }

  return merged;
};

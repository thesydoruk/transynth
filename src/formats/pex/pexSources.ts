/**
 * Discover compiled Papyrus scripts (.pex) next to a mod plugin.
 *
 * Mirrors the import-side PEX scan: GNRL BA2 archives first,
 * then loose `Scripts/*.pex` files (loose wins on name collision).
 */
import fs from 'node:fs';
import path from 'node:path';
import { BsaReader } from '../bsa';
import { getBa2Reader, isBa2GnrArchive } from '../ba2';
import { parsePexBuffer, pexScriptKeyFromInfo } from './pexParser';

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

const loadPexFromBa2 = (ba2Path: string): PexSourceFile[] => {
  const reader = getBa2Reader(ba2Path);
  const result: PexSourceFile[] = [];

  for (const entry of reader.listByExt('pex')) {
    try {
      const data = reader.extractEntry(entry);
      const { info } = parsePexBuffer(data);
      const scriptKey = pexScriptKeyFromInfo(info).toLowerCase();
      if (!scriptKey) continue;
      result.push({
        scriptKey,
        archivePath: normalizeArchivePath(entry.name),
        data,
      });
    } catch {
      // Skip unreadable entries — export proceeds with whatever parses cleanly.
    }
  }

  return result;
};

const loadPexFromBsa = (bsaPath: string): PexSourceFile[] => {
  const reader = new BsaReader(bsaPath);
  const result: PexSourceFile[] = [];

  for (const entry of reader.listByExt('pex')) {
    try {
      const data = reader.extractEntry(entry);
      const { info } = parsePexBuffer(data);
      const scriptKey = pexScriptKeyFromInfo(info).toLowerCase();
      if (!scriptKey) continue;
      result.push({
        scriptKey,
        archivePath: normalizeArchivePath(entry.name),
        data,
      });
    } catch {
      // Skip unreadable entries.
    }
  }

  return result;
};

const loadPexFromLooseFiles = (modDir: string): PexSourceFile[] => {
  const scriptsDir = path.join(modDir, 'Scripts');
  let files: string[];
  try {
    files = fs.readdirSync(scriptsDir).filter((f) => f.toLowerCase().endsWith('.pex'));
  } catch {
    return [];
  }

  const result: PexSourceFile[] = [];
  for (const file of files) {
    try {
      const data = fs.readFileSync(path.join(scriptsDir, file));
      const { info } = parsePexBuffer(data);
      const scriptKey = pexScriptKeyFromInfo(info).toLowerCase() || file.replace(/\.pex$/i, '');
      result.push({
        scriptKey: scriptKey.toLowerCase(),
        archivePath: `Scripts\\${file}`,
        data,
      });
    } catch {
      // Skip unreadable files.
    }
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
    for (const source of loadPexFromBa2(ba2Path)) {
      if (!merged.has(source.scriptKey)) merged.set(source.scriptKey, source);
    }
  }

  for (const bsaPath of listBsaFilesInDir(modDir)) {
    for (const source of loadPexFromBsa(bsaPath)) {
      if (!merged.has(source.scriptKey)) merged.set(source.scriptKey, source);
    }
  }

  for (const source of loadPexFromLooseFiles(modDir)) {
    merged.set(source.scriptKey, source);
  }

  return merged;
};

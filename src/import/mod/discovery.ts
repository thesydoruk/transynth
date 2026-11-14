import fs from 'node:fs';
import path from 'node:path';
import { discoverBa2Candidate, isBa2GnrArchive } from '../../formats/ba2';

const ARCHIVE_EXTS = new Set(['.zip', '.7z', '.rar']);
const PLUGIN_EXTS = new Set(['.esp', '.esm', '.esl']);

export const isArchive = (fileName: string): boolean => {
  return ARCHIVE_EXTS.has(path.extname(fileName).toLowerCase());
};

export const isPlugin = (fileName: string): boolean => {
  return PLUGIN_EXTS.has(path.extname(fileName).toLowerCase());
};

export const isPluginPath = (filePath: string): boolean => {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) return false;
  } catch {
    // Fall through to extension check.
  }
  return isPlugin(path.basename(filePath));
};

export const discoverModFiles = (
  dir: string,
): { plugins: string[]; ba2s: string[]; bsas: string[] } => {
  const plugins: string[] = [];
  const ba2s: string[] = [];
  const bsas: string[] = [];

  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (PLUGIN_EXTS.has(ext)) plugins.push(full);
      else if (ext === '.ba2') ba2s.push(full);
      else if (ext === '.bsa') bsas.push(full);
    }
  };
  walk(dir);
  return { plugins, ba2s, bsas };
};

export const discoverArchiveCandidatesForPlugin = (espPath: string): string[] => {
  const pluginDir = path.dirname(espPath);
  const fromPluginDir = discoverModFiles(pluginDir);
  const candidates = [...fromPluginDir.ba2s, ...fromPluginDir.bsas];
  if (candidates.length > 0) return candidates;

  const parentDir = path.dirname(pluginDir);
  if (parentDir === pluginDir) return candidates;

  const fromParent = discoverModFiles(parentDir);
  return [...fromParent.ba2s, ...fromParent.bsas];
};

/** List GNRL-type BA2 archives in a mod directory (skips DX10 texture archives). */
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

/**
 * GNRL BA2 archives that belong to one plugin — not every archive in a shared `Data\`
 * folder. Matches `{Stem} - Main.ba2`, `{Stem} - Interface.ba2`, and other stem-prefixed
 * companions (same rules as STRINGS discovery).
 */
export const listCompanionGnrlBa2ForPlugin = (
  espPath: string,
  ba2Candidates: string[] = discoverArchiveCandidatesForPlugin(espPath),
): string[] => {
  const modDir = path.dirname(espPath);
  const stem = path.basename(espPath, path.extname(espPath)).toLowerCase();
  const ba2Cands = ba2Candidates.filter(
    (f) => f.toLowerCase().endsWith('.ba2') && isBa2GnrArchive(f),
  );
  const matched = new Set<string>();

  const primary = discoverBa2Candidate(espPath, ba2Cands, 'ba2');
  if (primary) matched.add(primary);

  for (const ba2 of ba2Cands) {
    const base = path.basename(ba2, '.ba2').toLowerCase();
    if (base.startsWith(stem)) matched.add(ba2);
  }

  for (const ba2 of listGnrBa2FilesInDir(modDir)) {
    const base = path.basename(ba2, '.ba2').toLowerCase();
    if (base.startsWith(stem)) matched.add(ba2);
  }

  return [...matched];
};

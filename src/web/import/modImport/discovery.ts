import fs from 'node:fs';
import path from 'node:path';
import { isBa2GnrArchive } from '../../../formats/ba2';
import type { GameType } from '../../../types';
import { resolveVortexFolderFromPath } from '../../../utils/vortexFolder';
import type { VortexFolderInfo } from '../../../utils/vortexFolder';
import type { ModFileCandidate } from './types';

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

export { extractArchive } from '../../../tools/archiveUtils';

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

/** Directory names skipped during recursive mod discovery. */
const MOD_SCAN_SKIP_DIRS = new Set(['.transynth-extracted', '.git', 'node_modules']);

/**
 * List supported mod files in a directory, optionally including subfolders.
 *
 * Used by batch scans of mod install trees where plugins and archives may sit
 * in nested folders (e.g. per-mod subdirectories under a staging directory).
 */
export const listModFilesInDirectory = (
  dir: string,
  recursive = true,
  scanRoot = dir,
): ModFileCandidate[] => {
  const candidates: ModFileCandidate[] = [];

  const walk = (currentDir: string) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !MOD_SCAN_SKIP_DIRS.has(entry.name)) walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const fileName = entry.name;
      const vortex = resolveVortexFolderFromPath(fullPath, scanRoot) ?? undefined;
      if (isPlugin(fileName)) {
        candidates.push({ fileName, filePath: fullPath, kind: 'plugin', vortex });
      } else if (isArchive(fileName)) {
        candidates.push({ fileName, filePath: fullPath, kind: 'archive', vortex });
      }
    }
  };

  walk(dir);

  candidates.sort((a, b) =>
    a.filePath.localeCompare(b.filePath, undefined, { sensitivity: 'base' }),
  );
  return candidates;
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

const discoverBa2 = (
  modPath: string,
  ba2Candidates: string[],
  game: GameType = 'fo4',
): string | null => {
  const stem = path.basename(modPath, path.extname(modPath)).toLowerCase();
  const baseStem = path.basename(modPath, path.extname(modPath));
  const suffixes =
    game === 'fo4' || game === 'fo76' ? [' - main', ' - interface', ''] : [' - main', ''];

  for (const suffix of suffixes) {
    const target = suffix ? `${stem}${suffix}` : stem;
    for (const ba2 of ba2Candidates) {
      if (path.basename(ba2, '.ba2').toLowerCase() === target) return ba2;
    }
  }

  const dir = path.dirname(modPath);
  for (const suffix of suffixes) {
    const candidate = suffix ? `${baseStem}${suffix}.ba2` : `${baseStem}.ba2`;
    const p = path.join(dir, candidate);
    if (fs.existsSync(p)) return p;
  }
  return null;
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
  game: GameType,
  ba2Candidates: string[] = discoverArchiveCandidatesForPlugin(espPath),
): string[] => {
  const modDir = path.dirname(espPath);
  const stem = path.basename(espPath, path.extname(espPath)).toLowerCase();
  const ba2Cands = ba2Candidates.filter(
    (f) => f.toLowerCase().endsWith('.ba2') && isBa2GnrArchive(f),
  );
  const matched = new Set<string>();

  const primary = discoverBa2(espPath, ba2Cands, game);
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

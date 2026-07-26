import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import type { GameType } from '../../types';
import { isStringsDirName, PLUGIN_EXTS, SKIP_DIRS } from './constants';

/** Collect plugin stems under a pack root (case-insensitive, without extension). */
export const collectPluginStems = (packRoot: string): Set<string> => {
  const stems = new Set<string>();

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || isStringsDirName(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!PLUGIN_EXTS.has(ext)) continue;
      stems.add(path.basename(entry.name, ext).toLowerCase());
    }
  };

  walk(packRoot);
  return stems;
};

/** Find a plugin file for a stem within the given search roots. */
export const findPluginFile = (
  stem: string,
  searchDirs: string[],
  recursive = true,
): string | null => {
  const stemLower = stem.toLowerCase();

  const tryDir = (dir: string): string | null => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !SKIP_DIRS.has(entry.name) && !isStringsDirName(entry.name)) {
          const nested = tryDir(full);
          if (nested) return nested;
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!PLUGIN_EXTS.has(ext)) continue;
      if (path.basename(entry.name, ext).toLowerCase() === stemLower) return full;
    }
    return null;
  };

  for (const dir of searchDirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    const hit = tryDir(path.resolve(dir));
    if (hit) return hit;
  }
  return null;
};

/** Resolve a plugin path from disk search and/or previously imported mods. */
export const resolvePluginPathForStem = async (
  stem: string,
  game: GameType,
  searchDirs: string[],
  db?: Tx,
): Promise<string | null> => {
  const fromDisk = findPluginFile(stem, searchDirs);
  if (fromDisk) return fromDisk;

  if (!db) return null;

  const stemLower = stem.toLowerCase();
  const { rows } = await db.query<{ abs_path: string }>(
    `SELECT abs_path FROM mods WHERE game = $1 AND abs_path IS NOT NULL`,
    [game],
  );

  for (const row of rows) {
    const pluginPath = row.abs_path;
    if (!pluginPath || !fs.existsSync(pluginPath)) continue;
    const ext = path.extname(pluginPath).toLowerCase();
    if (!PLUGIN_EXTS.has(ext)) continue;
    if (path.basename(pluginPath, ext).toLowerCase() === stemLower) return pluginPath;
  }

  return null;
};

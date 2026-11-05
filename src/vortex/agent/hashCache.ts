/**
 * sha1 per file, remembered by size and mtime, so the multi-gigabyte Main and
 * Voices archives of the game are read once, not on every scan. A rewrite that
 * keeps both size and mtime is missed; the periodic full scan and the server's
 * own merkle check on upload cover that.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sha1HexFile } from '../../utils/hash';
import type { FileHasher } from '../hashSubset';

export type HashCacheEntry = { size: number; mtimeMs: number; sha1: string };
export type HashCache = Record<string, HashCacheEntry>;

const cacheKey = (absPath: string): string => path.resolve(absPath).toLowerCase();

export const lookupCached = (
  cache: HashCache,
  absPath: string,
  stat: { size: number; mtimeMs: number },
): string | null => {
  const entry = cache[cacheKey(absPath)];
  return entry && entry.size === stat.size && entry.mtimeMs === stat.mtimeMs ? entry.sha1 : null;
};

export const rememberHash = (
  cache: HashCache,
  absPath: string,
  stat: { size: number; mtimeMs: number },
  sha1: string,
): void => {
  cache[cacheKey(absPath)] = { size: stat.size, mtimeMs: stat.mtimeMs, sha1 };
};

export const loadHashCache = (file: string): HashCache => {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return raw && typeof raw === 'object' ? (raw as HashCache) : {};
  } catch {
    return {};
  }
};

export const saveHashCache = (file: string, cache: HashCache): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, file);
};

/** A `hashFile` for `buildVortexInventory` that reads a file only when it changed. */
export const cachedFileHasher = (
  cache: HashCache,
  hashFile: FileHasher = sha1HexFile,
  counters: { hits: number; misses: number } = { hits: 0, misses: 0 },
): FileHasher => {
  return async (absPath: string): Promise<string> => {
    const stat = fs.statSync(absPath);
    const cached = lookupCached(cache, absPath, stat);
    if (cached) {
      counters.hits += 1;
      return cached;
    }
    counters.misses += 1;
    const sha1 = await hashFile(absPath);
    rememberHash(cache, absPath, stat, sha1);
    return sha1;
  };
};

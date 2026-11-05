import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cachedFileHasher,
  loadHashCache,
  lookupCached,
  saveHashCache,
  type HashCache,
} from '../hashCache';

describe('hash cache', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hash-cache-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('hashes a file once while size and mtime hold, again after a change', async () => {
    const file = path.join(dir, 'Fallout4 - Voices.ba2');
    fs.writeFileSync(file, 'one');
    const cache: HashCache = {};
    const counters = { hits: 0, misses: 0 };
    let reads = 0;
    const hashFile = cachedFileHasher(
      cache,
      async () => {
        reads += 1;
        return `sha-${reads}`;
      },
      counters,
    );

    expect(await hashFile(file)).toBe('sha-1');
    expect(await hashFile(file)).toBe('sha-1');
    expect(counters).toEqual({ hits: 1, misses: 1 });

    fs.writeFileSync(file, 'two!');
    expect(await hashFile(file)).toBe('sha-2');
    expect(reads).toBe(2);
  });

  it('is keyed case-insensitively and survives a save/load round trip', async () => {
    const file = path.join(dir, 'Plugin.esp');
    fs.writeFileSync(file, 'x');
    const cache: HashCache = {};
    await cachedFileHasher(cache, async () => 'abc')(file);
    const stat = fs.statSync(file);
    expect(lookupCached(cache, file.toUpperCase(), stat)).toBe('abc');
    expect(lookupCached(cache, file, { size: stat.size + 1, mtimeMs: stat.mtimeMs })).toBeNull();

    const cacheFile = path.join(dir, 'cache.json');
    saveHashCache(cacheFile, cache);
    expect(lookupCached(loadHashCache(cacheFile), file, stat)).toBe('abc');
    expect(loadHashCache(path.join(dir, 'missing.json'))).toEqual({});
  });
});

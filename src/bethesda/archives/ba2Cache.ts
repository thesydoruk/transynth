import path from 'node:path';
import { Ba2Reader } from './Ba2Reader';

const cache = new Map<string, Ba2Reader>();

/** Return a cached {@link Ba2Reader} for `ba2Path` (loads once per path until cleared). */
export const getBa2Reader = (ba2Path: string): Ba2Reader => {
  const key = path.resolve(ba2Path);
  let reader = cache.get(key);
  if (!reader) {
    reader = new Ba2Reader(key);
    cache.set(key, reader);
  }
  return reader;
};

/** Drop all cached readers (call after each mod import to free memory). */
export const clearBa2Cache = (): void => {
  cache.clear();
};

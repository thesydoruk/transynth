import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../../utils/file';
import type { ZipPackEntry } from './exportTypes';
import { mergeLangpackEntries } from './langpackMerge';

const isInsideRoot = (rootDir: string, destPath: string): boolean => {
  const root = path.resolve(rootDir);
  const dest = path.resolve(destPath);
  return dest === root || dest.startsWith(`${root}${path.sep}`);
};

/** Write merged langpack entries into a staging tree (later files overwrite). */
export const writeLangpackEntriesToDir = (rootDir: string, entries: ZipPackEntry[]): number => {
  let written = 0;
  for (const entry of mergeLangpackEntries(entries)) {
    const dest = path.join(rootDir, ...entry.name.split('/').filter(Boolean));
    if (!isInsideRoot(rootDir, dest)) {
      throw new Error(`Refusing to write export path outside staging: ${entry.name}`);
    }
    ensureDir(path.dirname(dest));
    if (entry.data) {
      fs.writeFileSync(dest, entry.data);
      written += 1;
      continue;
    }
    if (entry.absPath) {
      fs.copyFileSync(entry.absPath, dest);
      written += 1;
    }
  }
  return written;
};

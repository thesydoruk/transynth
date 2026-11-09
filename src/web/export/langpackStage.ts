import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../../utils/file';
import type { VortexFileWinner } from '../../vortex/types';
import type { ZipPackEntry } from './exportTypes';
import { mergeLangpackEntries, type TaggedLangpackEntry } from './langpackMerge';

const isInsideRoot = (rootDir: string, destPath: string): boolean => {
  const root = path.resolve(rootDir);
  const dest = path.resolve(destPath);
  return dest === root || dest.startsWith(`${root}${path.sep}`);
};

/**
 * A hard link where the volume allows one: a dubbed video weighs hundreds of
 * megabytes and the staging tree only lives until it is zipped, so copying it
 * would double the disk traffic for nothing. Nothing writes into a staged file.
 */
const linkOrCopy = (src: string, dest: string): void => {
  fs.rmSync(dest, { force: true });
  try {
    fs.linkSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
  }
};

/** Write merged langpack entries into a staging tree (later files overwrite). */
export const writeLangpackEntriesToDir = (
  rootDir: string,
  entries: ZipPackEntry[] | TaggedLangpackEntry[],
  fileWinners?: readonly VortexFileWinner[],
): number => {
  let written = 0;
  for (const entry of mergeLangpackEntries(entries, fileWinners)) {
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
      // A game's finalize pass may already have written the file in place.
      if (path.resolve(entry.absPath) !== path.resolve(dest)) linkOrCopy(entry.absPath, dest);
      written += 1;
    }
  }
  return written;
};

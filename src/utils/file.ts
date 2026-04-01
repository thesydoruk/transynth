import fs from 'fs';
import path from 'path';
import { log } from '../logger';

/**
 * Create a directory and all intermediate parents if they do not already exist.
 *
 * Equivalent to `mkdir -p`. No-op when the directory is already present.
 *
 * @param p - Absolute or relative path to the directory to create.
 */
export const ensureDir = (p: string) => {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
    log.debug(`Created directory: ${p}`);
  }
}

/**
 * Copy a file, creating intermediate destination directories as needed.
 *
 * Ensures the destination directory exists via {@link ensureDir}, then performs
 * an atomic (overwriting) copy using `fs.copyFileSync`.
 *
 * @param src - Absolute path to the source file.
 * @param dst - Absolute path to the destination file.
 */
export const copyFileSafe = (src: string, dst: string) => {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
  log.debug(`Copied ${src} → ${dst}`);
}

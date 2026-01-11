import fs from 'fs';
import path from 'path';
import { log } from '../logger.js';

export function ensureDir(p: string) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
    log.debug(`Created directory: ${p}`);
  }
}

export function copyFileSafe(src: string, dst: string) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
  log.debug(`Copied ${src} → ${dst}`);
}

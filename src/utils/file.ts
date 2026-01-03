import fs from 'fs';
import path from 'path';

export function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

export function copyFileSafe(src: string, dst: string) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

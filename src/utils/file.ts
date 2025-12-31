import fs from 'fs';
import path from 'path';

export function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

export function copyFileSafe(src: string, dst: string) {
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

export function fileHashSha1(p: string): string {
  const buf = fs.readFileSync(p);
  const crypto = awaitImport('crypto');
  return crypto.createHash('sha1').update(buf).digest('hex');
}

function awaitImport(name: 'crypto') {
  // Node CJS compat shim for ESM default import
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(name);
}

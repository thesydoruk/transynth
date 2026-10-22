import fs from 'node:fs';
import path from 'node:path';
import Seven from 'node-7z';
import { path7za } from '7zip-bin';
import { path7z as path7zFull } from '7z-bin';

/** 7za (standalone) for zip/7z; full 7z binary for RAR (7za cannot unpack RAR). */
const archiveExtractorBin = (archivePath: string): string => {
  const ext = path.extname(archivePath).toLowerCase();
  return ext === '.rar' ? path7zFull : path7za;
};

/** npm ci --ignore-scripts can leave bundled 7z binaries without execute permission. */
const ensureExtractorExecutable = (binPath: string): void => {
  try {
    fs.accessSync(binPath, fs.constants.X_OK);
  } catch {
    fs.chmodSync(binPath, 0o755);
  }
};

export const extractArchive = (archivePath: string, outDir: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const bin = archiveExtractorBin(archivePath);
    ensureExtractorExecutable(bin);
    const stream = Seven.extractFull(archivePath, outDir, {
      $bin: bin,
      yes: true,
      recursive: true,
    });
    stream.on('end', () => resolve());
    stream.on('error', (err: Error) => reject(err));
  });

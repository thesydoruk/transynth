import fs from 'node:fs';
import path from 'node:path';
import Seven from 'node-7z';
import { path7za } from '7zip-bin';
import { path7z as path7zFull } from '7z-bin';

/**
 * The current 7-Zip (`7z-bin`) for every archive. The standalone `7za` of
 * `7zip-bin` is p7zip 16.02 on Linux: it reports "Headers Error" and exits 2 on
 * a valid Zip64 archive over 4 GiB (Starfield's 8.5 GB Vortex unit), although it
 * unpacks every file, and it cannot read RAR at all. It stays as the fallback
 * for a platform `7z-bin` ships no binary for — never for RAR.
 */
export const archiveExtractorBin = (archivePath: string): string => {
  if (path.extname(archivePath).toLowerCase() === '.rar') return path7zFull;
  return fs.existsSync(path7zFull) ? path7zFull : path7za;
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

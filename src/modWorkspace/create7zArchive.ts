import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { path7za } from '7zip-bin';
import { ensureDir } from '../utils/file';

/** 7-Zip LZMA2 options for maximum compression (mod release archives). */
const SEVEN_ZIP_MAX_ARGS = ['-t7z', '-mx=9', '-mfb=273', '-md=64m', '-ms=on'] as const;

/** Create a .7z archive from all files under `sourceDir` (paths preserved). */
export const create7zArchive = (sourceDir: string, archivePath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(archivePath));
    if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);

    execFile(
      path7za,
      ['a', ...SEVEN_ZIP_MAX_ARGS, '-y', '-r', archivePath, '.'],
      { cwd: sourceDir },
      (err, _stdout, stderr) => {
        if (err) {
          reject(new Error(`7z failed: ${stderr || err.message}`));
          return;
        }
        resolve();
      },
    );
  });
};

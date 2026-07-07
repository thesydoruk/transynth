import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { path7za } from '7zip-bin';
import { ensureDir } from '../utils/file';

/** Create a .7z archive from all files under `sourceDir` (paths preserved). */
export const create7zArchive = (sourceDir: string, archivePath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(archivePath));
    if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);

    execFile(
      path7za,
      ['a', '-t7z', '-y', '-r', archivePath, '.'],
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

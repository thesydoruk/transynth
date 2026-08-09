import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureDir } from '../../../utils/file';

const execFileAsync = promisify(execFile);

/** Extract a .tar / .tar.gz archive with system tar (preferred for CV MDC dumps). */
export const extractTarGz = async (archivePath: string, outDir: string): Promise<void> => {
  ensureDir(outDir);
  await execFileAsync('tar', ['-xzf', archivePath, '-C', outDir], {
    maxBuffer: 16 * 1024 * 1024,
  });
};

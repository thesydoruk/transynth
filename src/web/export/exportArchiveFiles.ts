import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../../paths';
import { ensureDir } from '../../utils/file';

export const exportArchiveDir = (archiveId: number): string =>
  path.join(PATHS.exports, String(archiveId));

export const exportArchiveZipPath = (archiveId: number, fileName: string): string =>
  path.join(exportArchiveDir(archiveId), fileName);

export const exportArchiveRelPath = (archiveId: number, fileName: string): string =>
  path.posix.join(String(archiveId), fileName);

export const resolveExportArchiveFile = (relPath: string): string | null => {
  const dest = path.resolve(PATHS.exports, ...relPath.split('/').filter(Boolean));
  const root = path.resolve(PATHS.exports);
  if (dest !== root && !dest.startsWith(`${root}${path.sep}`)) return null;
  return dest;
};

export const ensureExportArchiveDir = (archiveId: number): string => {
  const dir = exportArchiveDir(archiveId);
  ensureDir(dir);
  return dir;
};

export const removeExportArchiveFiles = (archiveId: number): void => {
  fs.rmSync(exportArchiveDir(archiveId), { recursive: true, force: true });
};

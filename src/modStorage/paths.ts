/**
 * Shared on-disk layout for mod uploads and import extraction.
 *
 * Everything lives under {@link PATHS.modUploads} (default `data/uploads/mod`):
 * - uploaded archives/plugins at the root,
 * - `_extracted_{hash}/` trees with `import-manifest.json` and optional `localize/`,
 * - `_output/{extractName}/` packed .7z archives.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../paths';

const INVALID_DIR_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

/** Root directory for all mod file storage. */
export const modStorageRoot = (): string => PATHS.modUploads;

/** Sanitize a folder name for Windows and POSIX filesystems. */
export const sanitizeModDirName = (name: string): string => {
  const trimmed = name.trim().replace(INVALID_DIR_CHARS, '_').replace(/\.+$/, '');
  return trimmed.length > 0 ? trimmed : 'mod';
};

export const ensureModStorageDir = (): void => {
  if (!fs.existsSync(modStorageRoot())) {
    fs.mkdirSync(modStorageRoot(), { recursive: true });
  }
};

/** Stored upload path for one archive or plugin file (basename only). */
export const modUploadedFilePath = (fileName: string): string =>
  path.join(modStorageRoot(), path.basename(fileName));

/** Web-import extraction directory for one archive upload. */
export const modImportExtractDir = (jobHash: string): string =>
  path.join(modStorageRoot(), `_extracted_${jobHash}`);

export const modUploadTempPath = (): string =>
  path.join(modStorageRoot(), `_upload_${crypto.randomBytes(8).toString('hex')}.tmp`);

export const modNexusDownloadTempPath = (): string =>
  path.join(modStorageRoot(), `_nexus_${crypto.randomBytes(8).toString('hex')}.tmp`);

/** Localized deltas written next to the import extract tree. */
export const modImportLocalizeDir = (extractRoot: string): string =>
  path.join(extractRoot, 'localize');

/** Packed .7z output directory for one import extract tree. */
export const modImportPackOutputDir = (extractRoot: string): string =>
  path.join(modStorageRoot(), '_output', path.basename(extractRoot));

/** Return localize dir when localized deltas exist for an import extract tree. */
export const resolveModImportLocalizeDir = (extractRoot: string): string | null => {
  const localizeDir = modImportLocalizeDir(extractRoot);
  return fs.existsSync(localizeDir) ? localizeDir : null;
};

export const isInsideModStorage = (absPath: string): boolean => {
  const rel = path.relative(modStorageRoot(), path.resolve(absPath));
  return !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** Resolve `_extracted_*` root for a plugin path under mod storage, if any. */
export const resolveModImportExtractRoot = (pluginPath: string): string | null => {
  const absPluginPath = path.resolve(pluginPath);
  if (!isInsideModStorage(absPluginPath)) return null;

  let current =
    fs.existsSync(absPluginPath) && fs.statSync(absPluginPath).isDirectory()
      ? absPluginPath
      : path.dirname(absPluginPath);

  while (isInsideModStorage(current)) {
    if (path.basename(current).startsWith('_extracted_')) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
};

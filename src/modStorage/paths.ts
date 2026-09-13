/**
 * Shared on-disk layout for mod uploads and import extraction.
 *
 * Everything lives under {@link PATHS.modUploads} (default `data/uploads/mod`):
 * - uploaded archives/plugins at the root,
 * - `_extracted_{hash}/` trees with original mod files only,
 * - _localize_{hash}/{lang}/ localized deltas (STRINGS, scripts, voice, …),
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

/**
 * Stable storage key shared by `_extracted_{key}` and `_localize_{key}` trees.
 */
export const modImportStorageKey = (extractRoot: string): string => {
  const resolved = path.resolve(extractRoot);
  const base = path.basename(resolved);
  if (base.startsWith('_extracted_')) return base.slice('_extracted_'.length);
  return crypto.createHash('sha1').update(resolved).digest('hex').slice(0, 16);
};

/** Root directory for all localized deltas of one import extract tree. */
export const modImportLocalizeRoot = (extractRoot: string): string =>
  path.join(modStorageRoot(), `_localize_${modImportStorageKey(extractRoot)}`);

/** Localized deltas for one target language under `_localize_{hash}/{lang}/`. */
export const modImportLocalizeDir = (extractRoot: string, lang: string): string => {
  const normalized = lang.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Target language is required for localize directory');
  }
  return path.join(modImportLocalizeRoot(extractRoot), normalized);
};

/** Packed .7z output directory for one import extract tree. */
export const modImportPackOutputDir = (extractRoot: string): string =>
  path.join(modStorageRoot(), '_output', path.basename(path.resolve(extractRoot)));

/** Return localize dir when localized deltas exist for an import extract tree. */
export const resolveModImportLocalizeDir = (extractRoot: string, lang: string): string | null => {
  const localizeDir = modImportLocalizeDir(extractRoot, lang);
  return fs.existsSync(localizeDir) ? localizeDir : null;
};

const isInsideRoot = (absPath: string, root: string): boolean => {
  const rel = path.relative(path.resolve(root), path.resolve(absPath));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

export const isInsideModStorage = (absPath: string): boolean =>
  isInsideRoot(absPath, modStorageRoot());

const isInsideVortexUploads = (absPath: string): boolean =>
  isInsideRoot(absPath, PATHS.vortexUploads);

const startWalkDir = (absPath: string): string =>
  fs.existsSync(absPath) && fs.statSync(absPath).isDirectory() ? absPath : path.dirname(absPath);

const walkForExtractRoot = (
  startDir: string,
  inside: (dir: string) => boolean,
  isRoot: (dir: string) => boolean,
): string | null => {
  let current = startDir;
  while (inside(current)) {
    if (isRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
};

/** Vortex extract: `uploads/vortex/{groupId}/{contentHash}/`. */
const isVortexExtractRoot = (dir: string): boolean => {
  const vortexRoot = path.resolve(PATHS.vortexUploads);
  const parent = path.dirname(dir);
  return parent !== vortexRoot && path.dirname(parent) === vortexRoot;
};

/** Remap a DB-stored path from another host/OS to the current {@link PATHS.dataDir}. */
export const resolveModStoredPath = (storedPath: string): string => {
  const trimmed = storedPath.trim();
  if (!trimmed) return trimmed;

  const direct = path.resolve(trimmed);
  if (fs.existsSync(direct)) return direct;

  const normalized = trimmed.replace(/\\/g, '/');
  const marker = '/data/';
  const markerIdx = normalized.toLowerCase().lastIndexOf(marker);
  if (markerIdx >= 0) {
    const suffix = normalized.slice(markerIdx + marker.length);
    return path.resolve(PATHS.dataDir, ...suffix.split('/').filter(Boolean));
  }

  if (normalized.startsWith('./data/')) {
    const suffix = normalized.slice('./data/'.length);
    return path.resolve(PATHS.dataDir, ...suffix.split('/').filter(Boolean));
  }

  return direct;
};

/**
 * Resolve the import extract root for a plugin path.
 *
 * Manual uploads live under `_extracted_{hash}/`. Vortex packs live under
 * `uploads/vortex/{groupId}/{hash}/` — without that, voice UI cannot find
 * `_localize_{key}/{lang}` that TM / carry-over already wrote.
 */
export const resolveModImportExtractRoot = (pluginPath: string): string | null => {
  const startDir = startWalkDir(path.resolve(pluginPath));
  return (
    walkForExtractRoot(startDir, isInsideModStorage, (dir) =>
      path.basename(dir).startsWith('_extracted_'),
    ) ?? walkForExtractRoot(startDir, isInsideVortexUploads, isVortexExtractRoot)
  );
};

/** Resolve `_localize_*` root for a plugin path under mod storage, if any. */
export const resolveModImportLocalizeRoot = (pluginPath: string): string | null => {
  const absPluginPath = path.resolve(pluginPath);
  if (!isInsideModStorage(absPluginPath)) return null;

  let current =
    fs.existsSync(absPluginPath) && fs.statSync(absPluginPath).isDirectory()
      ? absPluginPath
      : path.dirname(absPluginPath);

  while (isInsideModStorage(current)) {
    if (path.basename(current).startsWith('_localize_')) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
};

/**
 * Shared on-disk layout for mod uploads and import extraction.
 *
 * Everything lives under {@link PATHS.modUploads} (default `data/uploads/mod`):
 * - uploaded archives/plugins at the root,
 * - `_extracted_{hash}/` trees with original mod files only,
 * - _localize_{hash}/{lang}/ localized deltas (STRINGS, scripts, voice, …),
 * - `_output/{extractName}/` packed .7z archives,
 * - `_reference_voice/{game}/{lang}/` synthesized takes kept past their mod
 *   (see `src/voice/referenceVoiceTakes.ts`); belongs to no mod, and no mod
 *   deletion removes it.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../paths';

/** Root directory for all mod file storage. */
export const modStorageRoot = (): string => PATHS.modUploads;

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

/** Root of the reference voice store: takes that outlive the mod they were made for. */
export const referenceVoiceRoot = (): string => path.join(modStorageRoot(), '_reference_voice');

export type ReferenceVoiceTakeKey = {
  /** Reference game key (`referenceGameKey`). */
  game: string;
  lang: string;
  /** SHA-1 of the original voice file. */
  sourceSha1: string;
  /** TTS payload version (`voice_synthesis_state.tts_text_version`). */
  ttsTextVersion: string;
  /** Extension of the take with its dot, e.g. `.fuz`. */
  fileExt: string;
};

/**
 * Content-addressed path of one reference take:
 * `_reference_voice/{game}/{lang}/{sha1[0:2]}/{sha1}-{version[0:16]}{ext}`.
 * Every part ends up in a file name, so anything but the expected alphabet throws.
 */
export const referenceVoiceTakePath = (key: ReferenceVoiceTakeKey): string => {
  const game = key.game.trim().toLowerCase();
  const lang = key.lang.trim().toLowerCase();
  const sha1 = key.sourceSha1.trim().toLowerCase();
  const version = key.ttsTextVersion.trim().toLowerCase();
  const ext = key.fileExt.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(game)) throw new Error(`Invalid reference game key: ${game}`);
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(lang)) throw new Error(`Invalid target language: ${lang}`);
  if (!/^[0-9a-f]{40}$/.test(sha1)) throw new Error(`Invalid source SHA-1: ${sha1}`);
  if (!/^[0-9a-f]{16,}$/.test(version)) throw new Error(`Invalid TTS text version: ${version}`);
  if (!/^\.[a-z0-9]{1,8}$/.test(ext)) throw new Error(`Invalid take extension: ${ext}`);
  return path.join(
    referenceVoiceRoot(),
    game,
    lang,
    sha1.slice(0, 2),
    `${sha1}-${version.slice(0, 16)}${ext}`,
  );
};

/** Return localize dir when localized deltas exist for an import extract tree. */
export const resolveModImportLocalizeDir = (extractRoot: string, lang: string): string | null => {
  const localizeDir = modImportLocalizeDir(extractRoot, lang);
  return fs.existsSync(localizeDir) ? localizeDir : null;
};

const isInsideRoot = (absPath: string, root: string): boolean => {
  const rel = path.relative(path.resolve(root), path.resolve(absPath));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const isInsideModStorage = (absPath: string): boolean => isInsideRoot(absPath, modStorageRoot());

const isInsideVortexUploads = (absPath: string): boolean =>
  isInsideRoot(absPath, PATHS.vortexUploads);

/**
 * True when a path is a file Transynth stored itself (mod uploads or Vortex
 * packs), so deleting the mod may delete it. Scanned plugins are registered in
 * place — their paths point into the user's game or mod folder and must survive.
 */
export const isOwnedModStoragePath = (absPath: string): boolean => {
  const resolved = path.resolve(absPath);
  if (resolved === path.resolve(modStorageRoot())) return false;
  if (resolved === path.resolve(PATHS.vortexUploads)) return false;
  return isInsideModStorage(resolved) || isInsideVortexUploads(resolved);
};

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
export const isVortexExtractRoot = (dir: string): boolean => {
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

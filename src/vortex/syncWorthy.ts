import path from 'node:path';
import { isBa2GnrArchive } from '../formats/ba2';
import { isInterfaceTranslatePath } from '../formats/interface';
import { isMcmTranslationArchivePath } from '../formats/mcm';
import { isPlugin } from '../import/mod/discovery';

const ARCHIVE_EXT = new Set(['.ba2', '.bsa']);
const STRING_TABLE_EXT = new Set(['.strings', '.dlstrings', '.ilstrings']);
const VOICE_EXT = new Set(['.fuz', '.xwm', '.wav']);

/**
 * CK-tagged archives we send whole: Main (PEX / extra strings), Interface
 * (vanilla strings + UI), Voices (reference audio for synthesis).
 * Meshes / Sounds / Textures / … stay on disk — they are not unpacked here.
 */
export const isVortexSyncArchiveName = (fileName: string): boolean => {
  const ext = path.extname(fileName).toLowerCase();
  if (!ARCHIVE_EXT.has(ext)) return false;
  const tagged = fileName.toLowerCase().match(/ - ([^.]+)\.(ba2|bsa)$/);
  if (!tagged) return true;
  const role = tagged[1]!;
  return role === 'main' || role.startsWith('interface') || role.startsWith('voice');
};

export const isVoiceSourceRelPath = (relPath: string): boolean => {
  const lower = relPath.replace(/\\/g, '/').toLowerCase();
  const ext = path.extname(lower);
  if (!VOICE_EXT.has(ext)) return false;
  return lower.includes('/sound/voice/') || lower.startsWith('sound/voice/');
};

const isSyncTxt = (relPath: string): boolean =>
  isInterfaceTranslatePath(relPath) || isMcmTranslationArchivePath(relPath);

/** Matches server `selectArchiveImportAnchor`: plugin or MCM / Interface txt. */
export const hasVortexImportAnchor = (relPaths: readonly string[]): boolean =>
  relPaths.some((rel) => {
    const base = path.basename(rel);
    if (isPlugin(base)) return true;
    return path.extname(base).toLowerCase() === '.txt' && isSyncTxt(rel);
  });

export const isVortexSyncFile = (
  absPath: string,
  fileName: string,
  relPath = fileName,
): boolean => {
  const ext = path.extname(fileName).toLowerCase();
  if (isPlugin(fileName)) return true;
  if (STRING_TABLE_EXT.has(ext)) return true;
  if (ext === '.pex') return true;
  if (ext === '.txt' && isSyncTxt(relPath)) return true;
  if (isVoiceSourceRelPath(relPath)) return true;
  if (ext === '.ba2') return isVortexSyncArchiveName(fileName) && isBa2GnrArchive(absPath);
  if (ext === '.bsa') return isVortexSyncArchiveName(fileName);
  return false;
};

/** Skip asset dumps under Sound/, but keep Sound/Voice for loose reference clips. */
export const shouldSkipVortexWalkDir = (
  root: string,
  dirPath: string,
  dirName: string,
): boolean => {
  if (SKIP_VORTEX_WALK_DIRS.has(dirName.toLowerCase())) return true;
  const rel = path.relative(root, dirPath).replace(/\\/g, '/').toLowerCase();
  const parts = rel.split('/').filter(Boolean);
  const soundAt = parts.indexOf('sound');
  if (soundAt === -1) return false;
  const afterSound = parts.slice(soundAt + 1);
  return afterSound.length > 0 && afterSound[0] !== 'voice';
};

const SKIP_VORTEX_WALK_DIRS = new Set([
  '.git',
  'node_modules',
  '.transynth-extracted',
  'textures',
  'meshes',
  'music',
  'video',
  'docs',
  'documentation',
  'fomod',
  'optional',
]);

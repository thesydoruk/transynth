/**
 * Which inventory files are cutscene videos.
 *
 * Bethesda titles keep their pre-rendered films as Bink 2 files under `Video/`
 * (a mod folder is laid out like Data, so the same folder sits at its root).
 * The agent lists them with the rest of a unit so a changed video changes the
 * mod, but never uploads the file itself: the unit zip carries a manifest in
 * its place (see `src/video/manifest.ts`).
 */
import path from 'node:path';

const VIDEO_EXTENSIONS = new Set(['.bk2']);
const VIDEO_DIR = 'video';

export const isVideoFileName = (fileName: string): boolean =>
  VIDEO_EXTENSIONS.has(path.extname(fileName).toLowerCase());

/** `Video/<file>` or `Data/Video/<file>` with a video extension. */
export const isVideoRelPath = (relPath: string): boolean => {
  const parts = relPath.replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean);
  const name = parts.pop();
  if (!name || !isVideoFileName(name)) return false;
  if (parts.length === 1) return parts[0] === VIDEO_DIR;
  return parts.length === 2 && parts[0] === 'data' && parts[1] === VIDEO_DIR;
};

/** The staging folder of a videopack this agent delivered (`Transynth_<game>_<lang>_videopack_r<N>`). */
export const isTransynthVideopackFolder = (folderName: string): boolean =>
  /^transynth_.+_videopack_r\d+/i.test(folderName);

/** Where Vortex keeps the game's own file while a mod's copy is deployed over it. */
export const VORTEX_BACKUP_SUFFIX = '.vortex_backup';

import path from 'node:path';
import { PATHS } from '../../paths';
import { ensureDir } from '../../utils/file';

/** Absolute directory for a library source (`opentts`, `common_voice`). */
export const ukVoiceSourceDir = (source: string): string => {
  const dir = path.join(PATHS.ukVoiceLibrary, source);
  ensureDir(dir);
  return dir;
};

/** Resolve a library-relative audio path to an absolute WAV path. */
export const ukVoiceAudioAbsPath = (audioRelPath: string): string =>
  path.join(PATHS.ukVoiceLibrary, ...audioRelPath.split('/'));

/** Build a portable relative path stored in `uk_voice_library.audio_rel_path`. */
export const ukVoiceAudioRelPath = (source: string, fileName: string): string =>
  `${source}/${fileName}`.replace(/\\/g, '/');

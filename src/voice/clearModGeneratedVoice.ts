/**
 * Drop generated voice for one mod (or one speaker) so a "regenerate all"
 * run can continue as `scope=missing` and survive worker restarts.
 */
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import type { Tx } from '../db';
import { PATHS } from '../paths';
import { clearModVoiceSynthesisState } from './voiceSynthesisState';

export type ClearModGeneratedVoiceResult = {
  filesRemoved: number;
  dbRowsRemoved: number;
  previewCacheCleared: boolean;
};

const VOICE_AUDIO_GLOBS = ['**/Sound/Voice/**/*.{fuz,wav}', '**/Audio/**/*.wav'] as const;

const removeDirIfExists = (dir: string): boolean => {
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
};

const matchesSpeakerFolder = (filePath: string, speakerKey: string): boolean => {
  const needle = `/${speakerKey.replace(/\\/g, '/').replace(/\/+$/, '')}/`;
  return filePath.replace(/\\/g, '/').includes(needle);
};

/** Delete localized `.fuz` / `.wav` under one `_localize_{hash}/{lang}/` tree. */
export const clearModLocalizedVoiceFiles = (localizeDir: string, speakerKey?: string): number => {
  if (!fs.existsSync(localizeDir)) return 0;
  const cwd = localizeDir.replace(/\\/g, '/');
  const matches = fg.sync([...VOICE_AUDIO_GLOBS], {
    cwd,
    onlyFiles: true,
    dot: false,
    caseSensitiveMatch: false,
    absolute: true,
  });
  const speaker = speakerKey?.trim();
  const toRemove = speaker
    ? matches.filter((file) => matchesSpeakerFolder(file, speaker))
    : matches;
  for (const file of toRemove) {
    fs.unlinkSync(file);
  }
  return toRemove.length;
};

/** Delete this mod's generated voice files, synthesis stamps, and translation previews. */
export const clearModGeneratedVoice = async (
  db: Tx,
  opts: { modId: number; targetLang: string; localizeDir: string; speakerKey?: string },
): Promise<ClearModGeneratedVoiceResult> => {
  const speakerKey = opts.speakerKey?.trim() || undefined;
  const filesRemoved = clearModLocalizedVoiceFiles(opts.localizeDir, speakerKey);
  let dbRowsRemoved = 0;
  try {
    dbRowsRemoved = await clearModVoiceSynthesisState(db, opts.modId, opts.targetLang, speakerKey);
  } catch {
    // Files are cleared even when the DB is unavailable.
  }
  const previewDir = path.join(PATHS.voicePreview, String(opts.modId), 'translation');
  const previewCacheCleared = removeDirIfExists(previewDir);
  return { filesRemoved, dbRowsRemoved, previewCacheCleared };
};

/**
 * Drop generated voice for one mod (or one speaker) so a "regenerate all"
 * run can continue as `scope=missing` and survive worker restarts.
 */
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import type { Tx } from '../db';
import { PATHS } from '../paths';
import { LOCALIZED_TAKE_EXTENSIONS } from './takeFormat';
import { clearModVoiceSynthesisState } from './voiceSynthesisState';

export type ClearModGeneratedVoiceResult = {
  filesRemoved: number;
  dbRowsRemoved: number;
  previewCacheCleared: boolean;
};

/** Bethesda takes of any format with what travels with them, and Disco's loose `.wav`. */
const VOICE_AUDIO_GLOBS = [
  `**/Sound/Voice/**/*.{${[
    ...LOCALIZED_TAKE_EXTENSIONS.takes,
    'wav',
    ...LOCALIZED_TAKE_EXTENSIONS.sidecars,
  ].join(',')}}`,
  '**/Audio/**/*.wav',
] as const;

const isTakeSidecar = (filePath: string): boolean =>
  LOCALIZED_TAKE_EXTENSIONS.sidecars.some((extension) =>
    filePath.toLowerCase().endsWith(`.${extension}`),
  );

const removeDirIfExists = (dir: string): boolean => {
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
};

const matchesSpeakerFolder = (filePath: string, speakerKey: string): boolean => {
  const needle = `/${speakerKey.replace(/\\/g, '/').replace(/\/+$/, '')}/`;
  return filePath.replace(/\\/g, '/').includes(needle);
};

/**
 * Delete localized takes under one `_localize_{hash}/{lang}/` tree. Returns
 * the number of takes removed; the files that travel with one are not counted.
 */
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
  return toRemove.filter((file) => !isTakeSidecar(file)).length;
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

import fs from 'node:fs';
import fg from 'fast-glob';
import type { Tx } from '../db';
import { PATHS } from '../paths';
import { modStorageRoot } from '../modStorage';
import { LOCALIZED_TAKE_EXTENSIONS } from './takeFormat';
import { clearAllVoiceSynthesisState } from './voiceSynthesisState';

export type ClearGeneratedVoiceResult = {
  fuzFilesRemoved: number;
  previewCacheCleared: boolean;
  regenerateCacheCleared: boolean;
  dbRowsRemoved: number;
};

const removeDirIfExists = (dir: string): boolean => {
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
};

/**
 * Delete synthesized takes — `.fuz`, or `.wem` with its `.ffxanim` — under all
 * `_localize_*` trees. Returns the number of takes; a sidecar is not counted.
 */
const clearGeneratedVoiceFiles = (): number => {
  const root = modStorageRoot().replace(/\\/g, '/');
  const { takes, sidecars } = LOCALIZED_TAKE_EXTENSIONS;
  const matches = fg.sync(
    `${root}/_localize_*/**/Sound/Voice/**/*.{${[...takes, ...sidecars].join(',')}}`,
    { onlyFiles: true, dot: false },
  );
  for (const file of matches) {
    fs.unlinkSync(file);
  }
  const isSidecar = (file: string): boolean =>
    sidecars.some((extension) => file.toLowerCase().endsWith(`.${extension}`));
  return matches.filter((file) => !isSidecar(file)).length;
};

/** Delete generated voice files, preview caches, and synthesis version rows. */
export const clearGeneratedVoice = async (db: Tx): Promise<ClearGeneratedVoiceResult> => {
  const fuzFilesRemoved = clearGeneratedVoiceFiles();
  const previewCacheCleared = removeDirIfExists(PATHS.voicePreview);
  const regenerateCacheCleared = removeDirIfExists(PATHS.voiceRegenerate);
  let dbRowsRemoved = 0;
  try {
    dbRowsRemoved = await clearAllVoiceSynthesisState(db);
  } catch {
    // Files are cleared even when the DB is unavailable (e.g. local dev without postgres).
  }

  if (previewCacheCleared) {
    fs.mkdirSync(PATHS.voicePreview, { recursive: true });
  }
  if (regenerateCacheCleared) {
    fs.mkdirSync(PATHS.voiceRegenerate, { recursive: true });
  }

  return {
    fuzFilesRemoved,
    previewCacheCleared,
    regenerateCacheCleared,
    dbRowsRemoved,
  };
};

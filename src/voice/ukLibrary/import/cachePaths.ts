import path from 'node:path';
import { PATHS } from '../../../paths';
import { ensureDir } from '../../../utils/file';

/** Full corpus cache (opentts + CV). Defaults under DATA_DIR. */
export const ukVoiceCacheRoot = (): string => {
  const root = PATHS.ukVoiceCache;
  ensureDir(root);
  return root;
};

export const ukVoiceCacheOpenttsDir = (voiceSlug: string): string => {
  const dir = path.join(ukVoiceCacheRoot(), 'opentts', voiceSlug);
  ensureDir(dir);
  return dir;
};

export const ukVoiceCacheCommonVoiceDir = (): string => {
  const dir = path.join(ukVoiceCacheRoot(), 'common_voice_26_uk');
  ensureDir(dir);
  return dir;
};

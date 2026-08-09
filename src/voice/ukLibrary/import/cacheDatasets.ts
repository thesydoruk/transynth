import { log } from '../../../logger';
import { cacheAllOpenttsDatasets } from './cacheOpentts';
import { cacheCommonVoice26Uk } from './mdcDownload';

export type CacheUkVoiceDatasetsResult = {
  openttsClips: number;
  commonVoiceDir: string | null;
};

export type CacheUkVoiceDatasetsOptions = {
  opentts?: boolean;
  commonVoice?: boolean;
};

/** Download full opentts and/or Common Voice UA corpora into the voice cache. */
export const cacheUkVoiceDatasets = async (
  options: CacheUkVoiceDatasetsOptions = {},
): Promise<CacheUkVoiceDatasetsResult> => {
  const doOpentts = options.opentts !== false;
  const doCv = options.commonVoice !== false;
  log.info('Caching Ukrainian voice datasets…');
  const openttsClips = doOpentts ? await cacheAllOpenttsDatasets() : 0;
  const commonVoiceDir = doCv ? await cacheCommonVoice26Uk() : null;
  log.info(`Cache done: openttsClips=${openttsClips}, commonVoice=${commonVoiceDir ?? 'skipped'}`);
  return { openttsClips, commonVoiceDir };
};

import { voiceTranslationMapKey } from '../../../voice/loadVoiceTranslations';
import { discoVoiceFormidLower6 } from './discoverDiscoVoiceFiles';

/**
 * `FORMID6:variant` for a take file name, or null when it is not a take.
 *
 * Disco names takes after the lockit key rather than a FormID, so the stem is
 * hashed into one — the same hash the import records. There is one take per
 * line, so the variant is always 1.
 */
export const discoVoiceKeyFromFileName = (fileName: string): string | null => {
  if (!/\.wav$/i.test(fileName)) return null;
  const stem = fileName.replace(/\.[^.]+$/, '');
  return voiceTranslationMapKey(discoVoiceFormidLower6(stem), 1);
};

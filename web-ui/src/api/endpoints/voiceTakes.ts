import { getSrcLang, getTgtLang } from '../../langDefaults';
import { req } from '../client';
import type { VoiceLinePreview } from '../types';

export type VoiceTakeRemoveResult = { ok: true; takesRemoved: number; stampsRemoved: number };

export const voiceTakesEndpoints = {
  /**
   * Remove the synthesized take of one line in `targetLang`; the original take
   * stays. Succeeds with nothing removed when the line has no take.
   */
  removeTranslation: (
    modId: number,
    line: Pick<VoiceLinePreview, 'speakerKey' | 'lineKey' | 'variant' | 'originPlugin'>,
    srcLang = getSrcLang(),
    targetLang = getTgtLang(),
  ) => {
    const params = new URLSearchParams({ srcLang, targetLang });
    if (line.speakerKey?.trim()) params.set('speakerKey', line.speakerKey.trim());
    if (line.originPlugin?.trim()) params.set('originPlugin', line.originPlugin.trim());
    return req<VoiceTakeRemoveResult>(
      `/api/mods/${modId}/voice/translation-audio/${line.lineKey}/${line.variant}?${params}`,
      { method: 'DELETE' },
    );
  },
};

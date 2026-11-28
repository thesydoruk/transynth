import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { loadSpeakerClipEffort } from '../../../voice/voiceEffortStore';
import { voiceSynthesisStateKey } from '../../../voice/voiceSynthesisState';
import { getVoiceListContext } from './voiceListContext';
import { buildVoiceLinePreview, sortVoiceLines } from './buildVoiceLinePreview';
import { loadVoiceModGame, voiceEffortTagsStateFor, voiceLineEffortOf } from './voiceLineEffort';
import type { VoiceSpeakerLinesResult } from './types';

/** Load every voiced line of one speaker. */
export const listVoiceLinesForSpeaker = async (
  db: Tx,
  modId: number,
  speakerKey: string,
  srcLang: string,
  targetLang: string,
): Promise<VoiceSpeakerLinesResult> => {
  const normalizedKey = speakerKey.trim();
  if (!normalizedKey) {
    return { ok: false, reason: 'speaker_not_found', message: 'Speaker not found' };
  }

  const loaded = await getVoiceListContext(db, modId, srcLang, targetLang);
  if (!loaded.ok) return loaded;

  const effort = await loadSpeakerClipEffort(db, modId, normalizedKey);
  const lines = sortVoiceLines(
    loaded.voiceFiles
      .filter((entry) => loaded.speakerKeyOf(entry) === normalizedKey)
      .map((entry) =>
        buildVoiceLinePreview(
          loaded,
          entry,
          normalizedKey,
          // The key synthesis looks the tag up by, so the badge shows what a take gets.
          voiceLineEffortOf(
            effort.get(
              voiceSynthesisStateKey(
                normalizedKey,
                entry.lineKey,
                entry.variant,
                entry.originPlugin,
              ),
            ),
          ),
        ),
      ),
  );

  if (lines.length === 0) {
    return { ok: false, reason: 'speaker_not_found', message: 'Speaker not found' };
  }

  const tags = await voiceEffortTagsStateFor(db, await loadVoiceModGame(db, modId));
  log.debug(`Voice lines mod=${modId} speaker=${normalizedKey}: ${lines.length} lines`);
  return {
    ok: true,
    speakerKey: normalizedKey,
    lines,
    effortTagsSupported: tags.supported,
    effortTagsActive: tags.active,
  };
};

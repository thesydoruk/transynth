import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { getVoiceListContext } from './voiceListContext';
import { buildVoiceLinePreview, resolveSpeakerKey, sortVoiceLines } from './buildVoiceLinePreview';
import type { VoiceSpeakerLinesResult } from './types';

/** Load every voiced line of one speaker folder. */
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

  const { voiceFiles, voiceRootRel } = loaded.data;
  const lines = sortVoiceLines(
    voiceFiles
      .filter((entry) => resolveSpeakerKey(entry, voiceRootRel) === normalizedKey)
      .map((entry) => buildVoiceLinePreview(loaded.data, entry, normalizedKey)),
  );

  if (lines.length === 0) {
    return { ok: false, reason: 'speaker_not_found', message: 'Speaker not found' };
  }

  log.debug(`Voice lines mod=${modId} speaker=${normalizedKey}: ${lines.length} lines`);
  return { ok: true, speakerKey: normalizedKey, lines };
};

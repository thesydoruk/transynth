import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import {
  clearVoiceSpeakerRef,
  setVoiceSpeakerRef,
  type VoiceSpeakerRefPick,
} from '../../../voice/voiceSpeakerRefs';
import { isOrphanVoiceEntry } from './buildVoiceLinePreview';
import { resolveModVoiceContext } from './context';
import { getVoiceListContext } from './voiceListContext';
import type { VoiceSpeakerRefResult } from './types';

/**
 * Set or replace the TTS reference line for one speaker.
 *
 * The reference is the take the voice clone is conditioned on, so it must be a
 * line of this speaker that actually has source text.
 */
export const setVoiceSpeakerReferenceForMod = async (
  db: Tx,
  modId: number,
  speakerKey: string,
  lineKey: string,
  variant: number,
  srcLang: string = CONFIG.defaultSrcLang,
  targetLang: string = CONFIG.defaultTgtLang,
): Promise<VoiceSpeakerRefResult> => {
  const trimmedSpeaker = speakerKey.trim();
  if (!trimmedSpeaker) {
    return { ok: false, reason: 'speaker_not_found', message: 'Speaker key is required' };
  }

  const catalog = await getVoiceListContext(db, modId, srcLang, targetLang);
  if (!catalog.ok) {
    if (catalog.reason === 'no_voice_files') {
      return { ok: false, reason: 'line_not_found', message: catalog.message };
    }
    return { ok: false, reason: catalog.reason, message: catalog.message };
  }

  const wanted = lineKey.toUpperCase();
  const entry = catalog.voiceFiles.find(
    (candidate) =>
      candidate.lineKey.toUpperCase() === wanted &&
      candidate.variant === variant &&
      catalog.speakerKeyOf(candidate) === trimmedSpeaker,
  );
  if (!entry) {
    const existsElsewhere = catalog.voiceFiles.some(
      (candidate) => candidate.lineKey.toUpperCase() === wanted && candidate.variant === variant,
    );
    return existsElsewhere
      ? {
          ok: false,
          reason: 'line_not_in_speaker',
          message: 'Voice line does not belong to this speaker',
        }
      : { ok: false, reason: 'line_not_found', message: 'Voice line not found' };
  }

  // TTS is conditioned on the reference transcript, which orphan audio lacks.
  if (isOrphanVoiceEntry(catalog.sourceFormids, entry)) {
    return {
      ok: false,
      reason: 'line_no_record',
      message: 'Voice line has no dialogue record, so it cannot be used as a reference',
    };
  }

  const pick: VoiceSpeakerRefPick = {
    lineKey: entry.lineKey,
    variant: entry.variant,
  };
  await setVoiceSpeakerRef(db, modId, trimmedSpeaker, pick);
  return { ok: true, referencePick: pick };
};

/** Clear the saved TTS reference line for one speaker. */
export const clearVoiceSpeakerReferenceForMod = async (
  db: Tx,
  modId: number,
  speakerKey: string,
): Promise<VoiceSpeakerRefResult> => {
  const resolved = await resolveModVoiceContext(db, modId);
  if (!resolved.ok) return resolved;

  const trimmedSpeaker = speakerKey.trim();
  if (!trimmedSpeaker) {
    return { ok: false, reason: 'speaker_not_found', message: 'Speaker key is required' };
  }

  await clearVoiceSpeakerRef(db, modId, trimmedSpeaker);
  return { ok: true, referencePick: null };
};

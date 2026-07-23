import type { Tx } from '../../../db';
import { resolveVoiceRootRel } from '../../../voice/discoverVoiceFiles';
import { voiceSpeakerKey } from '../../../voice/speakerReference';
import {
  clearVoiceSpeakerRef,
  setVoiceSpeakerRef,
  type VoiceSpeakerRefPick,
} from '../../../voice/voiceSpeakerRefs';
import { resolveModVoiceContext } from './context';
import { discoverVoiceEntries, findVoiceEntry } from './voiceEntries';
import type { VoiceSpeakerRefResult } from './types';

/** Set or replace the TTS reference line for one speaker. */
export const setVoiceSpeakerReferenceForMod = async (
  db: Tx,
  modId: number,
  speakerKey: string,
  formidLower6: string,
  variant: number,
): Promise<VoiceSpeakerRefResult> => {
  const resolved = await resolveModVoiceContext(db, modId);
  if (!resolved.ok) return resolved;

  const trimmedSpeaker = speakerKey.trim();
  if (!trimmedSpeaker) {
    return { ok: false, reason: 'speaker_not_found', message: 'Speaker key is required' };
  }

  const voiceRootRel = resolveVoiceRootRel(resolved.ctx.pluginRel);
  const entry = findVoiceEntry(discoverVoiceEntries(resolved.ctx), formidLower6, variant);
  if (!entry) {
    return { ok: false, reason: 'line_not_found', message: 'Voice line not found' };
  }

  const entrySpeaker = voiceSpeakerKey(entry, voiceRootRel);
  if (entrySpeaker !== trimmedSpeaker) {
    return {
      ok: false,
      reason: 'line_not_in_speaker',
      message: 'Voice line does not belong to this speaker',
    };
  }

  const pick: VoiceSpeakerRefPick = {
    formidLower6: entry.formidLower6,
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

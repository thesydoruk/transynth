import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import {
  clearVoiceSpeakerRef,
  setVoiceSpeakerRef,
  type VoiceSpeakerRefPick,
} from '../../../voice/voiceSpeakerRefs';
import { isOrphanVoiceEntry, resolveSpeakerKey } from './buildVoiceLinePreview';
import { resolveModVoiceContext } from './context';
import { isDiscoMod } from './listDiscoVoice';
import { getVoiceListContext } from './voiceListContext';
import { findVoiceEntry } from './voiceEntries';
import { resolveDiscoVoiceExtractRoot } from '../../../voice/disco/discoverDiscoVoiceFiles';
import { resolveDiscoClipEntryByFormid } from '../../../voice/disco/resolveClipEntry';
import type { VoiceSpeakerRefResult } from './types';

/** Set or replace the TTS reference line for one speaker. */
export const setVoiceSpeakerReferenceForMod = async (
  db: Tx,
  modId: number,
  speakerKey: string,
  formidLower6: string,
  variant: number,
  srcLang: string = CONFIG.defaultSrcLang,
  targetLang: string = CONFIG.defaultTgtLang,
): Promise<VoiceSpeakerRefResult> => {
  const trimmedSpeaker = speakerKey.trim();
  if (!trimmedSpeaker) {
    return { ok: false, reason: 'speaker_not_found', message: 'Speaker key is required' };
  }

  if (await isDiscoMod(db, modId)) {
    const resolved = await resolveModVoiceContext(db, modId, targetLang);
    if (!resolved.ok) return resolved;
    const extractRoot = resolveDiscoVoiceExtractRoot(resolved.ctx.pluginPath);
    if (!extractRoot) {
      return { ok: false, reason: 'line_not_found', message: 'Disco pack root not found' };
    }
    const found = await resolveDiscoClipEntryByFormid(db, modId, extractRoot, formidLower6);
    if (!found) {
      return { ok: false, reason: 'line_not_found', message: 'Voice line not found' };
    }
    if (found.clip.speakerKey !== trimmedSpeaker) {
      return {
        ok: false,
        reason: 'line_not_in_speaker',
        message: 'Voice line does not belong to this speaker',
      };
    }
    if (found.clip.recordId == null) {
      return {
        ok: false,
        reason: 'line_no_record',
        message: 'Voice line has no dialogue record, so it cannot be used as a reference',
      };
    }
    const pick: VoiceSpeakerRefPick = {
      formidLower6: found.entry.formidLower6,
      variant: found.entry.variant,
    };
    await setVoiceSpeakerRef(db, modId, trimmedSpeaker, pick);
    return { ok: true, referencePick: pick };
  }

  const context = await getVoiceListContext(db, modId, srcLang, targetLang);
  if (!context.ok) {
    if (context.reason === 'no_voice_files') {
      return { ok: false, reason: 'line_not_found', message: context.message };
    }
    return { ok: false, reason: context.reason, message: context.message };
  }

  const entry = findVoiceEntry(context.data.voiceFiles, formidLower6, variant);
  if (!entry) {
    return { ok: false, reason: 'line_not_found', message: 'Voice line not found' };
  }

  if (
    resolveSpeakerKey(entry, context.data.voiceRootRel, context.data.isDisco) !== trimmedSpeaker
  ) {
    return {
      ok: false,
      reason: 'line_not_in_speaker',
      message: 'Voice line does not belong to this speaker',
    };
  }

  // TTS is conditioned on the reference transcript, which orphan audio lacks.
  if (isOrphanVoiceEntry(context.data.sourceFormids, entry)) {
    return {
      ok: false,
      reason: 'line_no_record',
      message: 'Voice line has no dialogue record, so it cannot be used as a reference',
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

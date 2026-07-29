import crypto from 'node:crypto';
import type { PrepareVoiceTtsTextResult } from './prepareVoiceTtsText';
import { resolveTtsLanguage } from './voiceToolPaths';

/**
 * Bump when post-TTS audio processing changes so stored `.fuz` files regenerate.
 *
 * Deliberately left at `en-peak-v1` after post-processing moved from peak to
 * speech-RMS matching: the already generated lines keep their audio instead of
 * being invalidated in bulk, so only lines regenerated for another reason pick
 * up the new level.
 */
export const VOICE_AUDIO_POST_VERSION = 'en-peak-v1';

/** Fields sent to Fish Speech (`POST /v1/synthesize`) plus post-process stamp. */
export type VoiceTtsPayload = {
  text: string;
  speakerText?: string;
  language: string;
};

/** Stable SHA-256 of the TTS request text fields (order-independent JSON). */
export const computeVoiceTtsPayloadVersion = (payload: VoiceTtsPayload): string => {
  const canonical = JSON.stringify({
    audioPost: VOICE_AUDIO_POST_VERSION,
    language: payload.language,
    speakerText: payload.speakerText?.trim() ?? '',
    text: payload.text.trim(),
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
};

export const voiceTtsPayloadVersionFromPrepared = (
  prepared: Extract<PrepareVoiceTtsTextResult, { action: 'synthesize' }>,
  tgtLang: string,
  speakerText?: string | null,
): string =>
  computeVoiceTtsPayloadVersion({
    text: prepared.text,
    speakerText: speakerText ?? prepared.speakerText,
    language: resolveTtsLanguage(tgtLang),
  });

export const isVoiceSynthesisCurrent = (
  storedVersion: string | null | undefined,
  payloadVersion: string,
  fuzExists: boolean,
): boolean => storedVersion === payloadVersion && fuzExists;

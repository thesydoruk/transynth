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
  /** @deprecated Prefer `speakerTexts` when multiple references are used. */
  speakerText?: string;
  /** Ordered transcripts matching each `speaker_wav`. */
  speakerTexts?: string[];
  language: string;
};

const canonicalSpeakerTexts = (payload: VoiceTtsPayload): string[] => {
  if (payload.speakerTexts && payload.speakerTexts.length > 0) {
    return payload.speakerTexts.map((t) => t.trim()).filter(Boolean);
  }
  const single = payload.speakerText?.trim() ?? '';
  return single ? [single] : [];
};

/** Stable SHA-256 of the TTS request text fields (order-independent JSON). */
export const computeVoiceTtsPayloadVersion = (payload: VoiceTtsPayload): string => {
  const canonical = JSON.stringify({
    audioPost: VOICE_AUDIO_POST_VERSION,
    language: payload.language,
    speakerTexts: canonicalSpeakerTexts(payload),
    text: payload.text.trim(),
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
};

export const voiceTtsPayloadVersionFromPrepared = (
  prepared: Extract<PrepareVoiceTtsTextResult, { action: 'synthesize' }>,
  tgtLang: string,
  speakerText?: string | string[] | null,
): string => {
  const speakerTexts = Array.isArray(speakerText)
    ? speakerText
    : speakerText != null
      ? [speakerText]
      : prepared.speakerText
        ? [prepared.speakerText]
        : [];
  return computeVoiceTtsPayloadVersion({
    text: prepared.text,
    speakerTexts,
    language: resolveTtsLanguage(tgtLang),
  });
};

export const isVoiceSynthesisCurrent = (
  storedVersion: string | null | undefined,
  payloadVersion: string,
  fuzExists: boolean,
): boolean => storedVersion === payloadVersion && fuzExists;

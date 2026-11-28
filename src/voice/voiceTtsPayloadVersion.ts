import crypto from 'node:crypto';
import type { PrepareVoiceTtsTextResult } from './prepareVoiceTtsText';
import { applyEffortTag } from './vocalEffort/decide';
import { resolveTtsLanguage } from './voiceToolPaths';

/**
 * Bump when TTS-server loudness/fade post-process changes so existing `.fuz`
 * files are treated as stale and re-synthesized.
 */
const VOICE_AUDIO_POST_VERSION = 'tts-server-loudness-v1';

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

type PreparedSpeech = Extract<PrepareVoiceTtsTextResult, { action: 'synthesize' }>;

/**
 * The text as the TTS server gets it: the line, behind its effort tag when it
 * has one. Only the synthesis request and the version stamp use this — the
 * lip-sync builder is given `prepared.text`, which has no tag to mouth.
 *
 * @example voiceTtsRequestText({ action: 'synthesize', text: 'Лягай!', speakerText: 'Get down!',
 *   effortTag: 'shouting' }) // '[shouting] Лягай!'
 */
export const voiceTtsRequestText = (prepared: PreparedSpeech): string =>
  applyEffortTag(prepared.text, prepared.effortTag ?? null);

/**
 * The stamp of a take made from this text. A line that gains or loses an
 * effort tag gets a new stamp, so its take — and only its take — goes stale.
 */
export const voiceTtsPayloadVersionFromPrepared = (
  prepared: PreparedSpeech,
  tgtLang: string,
  speakerText?: string | null,
): string =>
  computeVoiceTtsPayloadVersion({
    text: voiceTtsRequestText(prepared),
    speakerText: speakerText ?? prepared.speakerText,
    language: resolveTtsLanguage(tgtLang),
  });

export const isVoiceSynthesisCurrent = (
  storedVersion: string | null | undefined,
  payloadVersion: string,
  fuzExists: boolean,
): boolean => storedVersion === payloadVersion && fuzExists;

import path from 'node:path';
import type { TtsReferenceClip } from '../tts/ttsClient';
import { stripVoiceNonSpeechBlocks } from './prepareVoiceTtsText';

export type { TtsReferenceClip };

const sameWavPath = (a: string, b: string): boolean => path.resolve(a) === path.resolve(b);

const normalizeClip = (clip: TtsReferenceClip): TtsReferenceClip => ({
  wavPath: clip.wavPath,
  speakerText: stripVoiceNonSpeechBlocks(clip.speakerText ?? '') || undefined,
});

/**
 * Build the Fish Speech reference list: global voice reference first
 * (open-library UA pronunciation), then local voice reference (in-game
 * same-line or selected-line clip). Either side may be omitted.
 * Drops a duplicate when paths match.
 */
export const mergeTtsReferenceClips = (
  globalRef: TtsReferenceClip | null | undefined,
  local: TtsReferenceClip | null | undefined,
): TtsReferenceClip[] => {
  const clips: TtsReferenceClip[] = [];
  if (globalRef?.wavPath) {
    clips.push(normalizeClip(globalRef));
  }
  if (local?.wavPath && (!globalRef?.wavPath || !sameWavPath(local.wavPath, globalRef.wavPath))) {
    clips.push(normalizeClip(local));
  }
  return clips;
};

/** Ordered transcripts aligned with each reference clip (may include empty strings). */
export const speakerTextsFromClips = (clips: TtsReferenceClip[]): string[] =>
  clips.map((c) => c.speakerText?.trim() ?? '');

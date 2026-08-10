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
 * same-line or selected-line clip). Drops a duplicate when paths match.
 */
export const mergeTtsReferenceClips = (
  ukLibrary: TtsReferenceClip | null | undefined,
  local: TtsReferenceClip,
): TtsReferenceClip[] => {
  const clips: TtsReferenceClip[] = [];
  if (ukLibrary?.wavPath) {
    clips.push(normalizeClip(ukLibrary));
  }
  if (!ukLibrary?.wavPath || !sameWavPath(local.wavPath, ukLibrary.wavPath)) {
    clips.push(normalizeClip(local));
  }
  return clips;
};

/** Ordered transcripts aligned with each reference clip (may include empty strings). */
export const speakerTextsFromClips = (clips: TtsReferenceClip[]): string[] =>
  clips.map((c) => c.speakerText?.trim() ?? '');

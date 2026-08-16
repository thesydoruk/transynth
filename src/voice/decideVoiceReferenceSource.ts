import { MAX_REFERENCE_DURATION_SEC } from './speakerReference/constants';
import { wavDurationSec } from './speakerReference/pcm';
import { scoreReferenceWav } from './speakerReference/scoring';
import type { TtsReferenceMode } from './voiceToolPaths';

/** True when the original clip is longer than Fish Speech can clone from well. */
export const isLineReferenceTooLong = (wavPath: string): boolean =>
  wavDurationSec(wavPath) > MAX_REFERENCE_DURATION_SEC;

/** True when a line's English clip is usable as Fish Speech line-reference audio. */
export const isLineReferenceSuitable = (wavPath: string): boolean => {
  if (isLineReferenceTooLong(wavPath)) return false;
  return Number.isFinite(scoreReferenceWav(wavPath));
};

export type VoiceReferenceSourceDecision =
  | { kind: 'line' }
  | { kind: 'speaker'; reason: 'mode' | 'line_unsuitable' | 'line_too_long' };

/**
 * Choose line vs speaker (default) reference.
 * In line mode, short/unsuitable or over-long phrases fall back to a speaker clip.
 */
export const decideVoiceReferenceSource = (
  mode: TtsReferenceMode,
  lineSuitable: boolean,
  lineTooLong = false,
): VoiceReferenceSourceDecision => {
  if (mode === 'speaker') return { kind: 'speaker', reason: 'mode' };
  if (lineTooLong) return { kind: 'speaker', reason: 'line_too_long' };
  if (!lineSuitable) return { kind: 'speaker', reason: 'line_unsuitable' };
  return { kind: 'line' };
};

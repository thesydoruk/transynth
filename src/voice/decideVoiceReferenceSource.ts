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
  | { kind: 'short' }
  | { kind: 'speaker'; reason: 'mode' };

/**
 * Choose how to build Fish Speech references.
 *
 * A long original clip is never replaced: `match_timing` must see that duration.
 * A short clip stays first and extra speaker clips may be appended later.
 */
export const decideVoiceReferenceSource = (
  mode: TtsReferenceMode,
  lineSuitable: boolean,
  lineTooLong = false,
): VoiceReferenceSourceDecision => {
  if (lineTooLong) return { kind: 'line' };
  if (!lineSuitable) return { kind: 'short' };
  if (mode === 'speaker') return { kind: 'speaker', reason: 'mode' };
  return { kind: 'line' };
};

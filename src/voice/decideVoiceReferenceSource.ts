import type { TtsReferenceMode } from './voiceToolPaths';
import { scoreReferenceWav } from './speakerReference/scoring';

/** True when a line's English clip is usable as Fish Speech line-reference audio. */
export const isLineReferenceSuitable = (wavPath: string): boolean =>
  Number.isFinite(scoreReferenceWav(wavPath));

export type VoiceReferenceSourceDecision =
  | { kind: 'line' }
  | { kind: 'speaker'; reason: 'mode' | 'line_unsuitable' };

/**
 * Choose line vs speaker reference.
 * In line mode, short/unsuitable phrases fall back to a (auto-)saved speaker clip.
 */
export const decideVoiceReferenceSource = (
  mode: TtsReferenceMode,
  lineSuitable: boolean,
): VoiceReferenceSourceDecision => {
  if (mode === 'speaker') return { kind: 'speaker', reason: 'mode' };
  if (!lineSuitable) return { kind: 'speaker', reason: 'line_unsuitable' };
  return { kind: 'line' };
};

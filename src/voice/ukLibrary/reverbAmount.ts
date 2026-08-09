import type { AnalysisFrame } from '../speakerReference/analysisFrames';

const SILENCE_RMS = 800;
/** Frame length assumed by `analyzeFrames` (~25 ms). */
const FRAME_SEC = 0.025;
/** How long energy may linger after speech drops before we call it reverb. */
const DRY_DECAY_SEC = 0.08;
const WET_DECAY_SEC = 0.45;

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

const decaySecFrom = (
  frames: AnalysisFrame[],
  startIdx: number,
  lowThresh: number,
): number | null => {
  let j = startIdx + 1;
  while (j < frames.length && frames[j]!.rms > lowThresh) j += 1;
  if (j >= frames.length) return null;
  return (j - startIdx) * FRAME_SEC;
};

/**
 * Estimate room reverb / echo amount in \[0, 1\].
 *
 * Combines sharp speech→quiet transitions with phrase-end decay time (loud band
 * → low floor). Dry close-mic speech collapses in tens of ms; room recordings
 * leave a long tail that Fish Speech would clone into game VO.
 */
export const estimateReverbAmount = (frames: AnalysisFrame[], silenceRms = SILENCE_RMS): number => {
  if (frames.length < 8) return 0;

  let peak = 0;
  for (const frame of frames) {
    if (frame.rms > peak) peak = frame.rms;
  }
  if (peak < silenceRms * 2) return 0;

  const highThresh = Math.max(silenceRms * 2, peak * 0.45);
  const dropThresh = Math.max(silenceRms * 1.5, peak * 0.28);
  const lowThresh = Math.max(silenceRms, peak * 0.05);
  const decaySecs: number[] = [];

  for (let i = 0; i < frames.length - 2; i += 1) {
    const rms = frames[i]!.rms;
    const next = frames[i + 1]!.rms;
    // Sharp transition out of loud speech into a much quieter frame.
    if (rms < highThresh || next >= dropThresh || next >= rms * 0.55) continue;
    const decay = decaySecFrom(frames, i, lowThresh);
    if (decay != null) decaySecs.push(decay);
  }

  // Phrase-end decay: last frame still in the loud band → time to the low floor.
  // Catches gradual exponential tails that never make a one-frame hard drop.
  let lastHigh = -1;
  for (let i = 0; i < frames.length; i += 1) {
    if (frames[i]!.rms >= highThresh) lastHigh = i;
  }
  if (lastHigh >= 0) {
    const decay = decaySecFrom(frames, lastHigh, lowThresh);
    if (decay != null) decaySecs.push(decay);
  }

  const decay = median(decaySecs);
  if (decay == null) return 0;

  const normalized = Math.max(
    0,
    Math.min(1, (decay - DRY_DECAY_SEC) / (WET_DECAY_SEC - DRY_DECAY_SEC)),
  );
  return Math.round(normalized * 1000) / 1000;
};

/**
 * Points to subtract from a 0–100 quality score. Strong reverb is near-fatal for
 * game VO references (Fish Speech clones the room as well as the voice).
 */
export const reverbQualityPenalty = (reverbAmount: number): number => {
  if (reverbAmount <= 0) return 0;
  // Mild room: ~15–25; obvious reverb (≥0.45): 55–80.
  return Math.round(Math.pow(reverbAmount, 0.85) * 80);
};

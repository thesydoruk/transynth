import { analyzeFrames } from '../speakerReference/analysisFrames';
import { readPcmFromWav } from '../speakerReference/pcm';
import type { UkVoiceGender } from './types';

const SILENCE_RMS = 800;
const MIN_F0_HZ = 70;
const MAX_F0_HZ = 350;
/** Adult speech split used for binary male/female classification. */
const F0_GENDER_SPLIT_HZ = 165;

export type UkVoiceClipAnalysis = {
  gender: UkVoiceGender;
  genderConfidence: number;
  meanF0Hz: number | null;
  /** 0–100 reference suitability / production quality heuristic. */
  qualityScore: number;
};

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

/**
 * Estimate F0 for one frame via autocorrelation peak in the adult-speech lag range.
 * Returns null when the frame is unvoiced / silence.
 */
const estimateFrameF0 = (frame: Int16Array, sampleRate: number): number | null => {
  if (frame.length < 32) return null;
  let energy = 0;
  for (let i = 0; i < frame.length; i += 1) energy += frame[i]! * frame[i]!;
  const rms = Math.sqrt(energy / frame.length);
  if (rms < SILENCE_RMS) return null;

  const minLag = Math.floor(sampleRate / MAX_F0_HZ);
  const maxLag = Math.min(frame.length - 1, Math.floor(sampleRate / MIN_F0_HZ));
  if (maxLag <= minLag) return null;

  let bestLag = -1;
  let bestCorr = 0;
  let corr0 = 0;
  for (let i = 0; i < frame.length; i += 1) corr0 += frame[i]! * frame[i]!;
  if (corr0 <= 0) return null;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let corr = 0;
    const n = frame.length - lag;
    for (let i = 0; i < n; i += 1) corr += frame[i]! * frame[i + lag]!;
    const norm = corr / corr0;
    if (norm > bestCorr) {
      bestCorr = norm;
      bestLag = lag;
    }
  }

  // Require a clear periodicity peak.
  if (bestLag < 0 || bestCorr < 0.35) return null;
  return sampleRate / bestLag;
};

const detectGenderFromF0 = (
  meanF0Hz: number | null,
): { gender: UkVoiceGender; confidence: number } => {
  if (meanF0Hz == null || !Number.isFinite(meanF0Hz)) {
    return { gender: 'unknown', confidence: 0 };
  }
  const distance = Math.abs(meanF0Hz - F0_GENDER_SPLIT_HZ);
  const confidence = Math.max(0, Math.min(1, distance / 40));
  if (distance < 12) return { gender: 'unknown', confidence };
  return {
    gender: meanF0Hz < F0_GENDER_SPLIT_HZ ? 'male' : 'female',
    confidence,
  };
};

/**
 * Quality 0–100 for Fish Speech reference use: duration fit, speech activity,
 * loudness, clipping and hesitation penalties (same family as speaker-ref scoring).
 */
export const scoreUkVoiceQuality = (samples: Int16Array, sampleRate: number): number => {
  if (samples.length === 0 || sampleRate <= 0) return 0;
  const durationSec = samples.length / sampleRate;
  if (durationSec < 1.2 || durationSec > 14) return 5;

  const frames = analyzeFrames(samples, sampleRate);
  if (frames.length === 0) return 0;

  const active = frames.filter((f) => f.rms > SILENCE_RMS);
  const activityRatio = active.length / frames.length;
  const meanRms = frames.reduce((sum, f) => sum + f.rms, 0) / frames.length;
  const clipRatio = frames.filter((f) => f.rms > 28_000).length / frames.length;
  const silenceRms =
    frames.filter((f) => f.rms <= SILENCE_RMS).reduce((sum, f) => sum + f.rms, 0) /
      Math.max(1, frames.length - active.length) || 1;
  const snrDb = 20 * Math.log10(Math.max(meanRms, 1) / Math.max(silenceRms, 1));

  const durationScore = Math.exp(-((durationSec - 5) ** 2) / (2 * 2.5 ** 2)); // peak ~5s
  const activityScore = Math.min(1, activityRatio / 0.7);
  const snrScore = Math.max(0, Math.min(1, (snrDb - 6) / 24));
  const clipPenalty = Math.min(1, clipRatio * 8);

  const raw =
    durationScore * 30 + activityScore * 30 + snrScore * 30 + Math.min(10, Math.log10(meanRms)) * 1;
  return Math.max(0, Math.min(100, Math.round(raw - clipPenalty * 25)));
};

/** Analyze one normalized mono WAV for gender (F0) and reference quality. */
export const analyzeUkVoiceWav = (wavPath: string): UkVoiceClipAnalysis => {
  const { samples, sampleRate } = readPcmFromWav(wavPath);
  const frameSamples = Math.max(1, Math.floor(sampleRate * 0.04));
  const f0s: number[] = [];

  for (let i = 0; i + frameSamples <= samples.length; i += frameSamples) {
    const frame = samples.subarray(i, i + frameSamples);
    const f0 = estimateFrameF0(frame, sampleRate);
    if (f0 != null) f0s.push(f0);
  }

  const meanF0Hz = median(f0s);
  const { gender, confidence } = detectGenderFromF0(meanF0Hz);
  return {
    gender,
    genderConfidence: confidence,
    meanF0Hz: meanF0Hz == null ? null : Math.round(meanF0Hz * 10) / 10,
    qualityScore: scoreUkVoiceQuality(samples, sampleRate),
  };
};

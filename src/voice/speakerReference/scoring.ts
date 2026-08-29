import type { AnalysisFrame } from './analysisFrames';
import { analyzeFrames } from './analysisFrames';
import {
  MAX_REFERENCE_DURATION_SEC,
  MIN_REFERENCE_DURATION_SEC,
  PREFERRED_REFERENCE_DURATION_MAX_SEC,
  PREFERRED_REFERENCE_DURATION_MIN_SEC,
} from './constants';
import { readPcmFromWav } from './pcm';

export type ReferenceClipAnalysis = {
  durationSec: number;
  activeSec: number;
  score: number;
};

const DURATION_PEAK_SEC =
  (PREFERRED_REFERENCE_DURATION_MIN_SEC + PREFERRED_REFERENCE_DURATION_MAX_SEC) / 2;

const scoreDuration = (durationSec: number): number => {
  if (durationSec < MIN_REFERENCE_DURATION_SEC || durationSec > MAX_REFERENCE_DURATION_SEC)
    return 0;
  const spread = 2.5;
  return Math.exp(-((durationSec - DURATION_PEAK_SEC) ** 2) / (2 * spread ** 2));
};

/** Penalize long sustained-vowel segments (e.g. "aaaa", "eeee") in active speech. */
export const computeHesitationPenalty = (
  frames: AnalysisFrame[],
  silenceThreshold = 800,
): number => {
  const minRun = 8; // ~200 ms at 25 ms frames
  let run = 0;
  let maxRun = 0;
  let penalty = 0;

  for (const frame of frames) {
    const sustained = frame.rms > silenceThreshold && frame.zcr < 0.04 && frame.rms < 24_000;
    if (sustained) {
      run += 1;
      maxRun = Math.max(maxRun, run);
    } else {
      if (run >= minRun) penalty += run - minRun + 1;
      run = 0;
    }
  }
  if (run >= minRun) penalty += run - minRun + 1;

  return penalty / Math.max(frames.length, 1) + maxRun * 0.05;
};

const rejectAnalysis = (durationSec: number, activeSec = 0): ReferenceClipAnalysis => ({
  durationSec,
  activeSec,
  score: Number.NEGATIVE_INFINITY,
});

/**
 * Duration, active-speech length, and quality score for one reference clip.
 * Score is `-Infinity` when the clip is unsuitable as an XTTS reference.
 */
export const analyzeReferencePcm = (
  samples: Int16Array,
  sampleRate: number,
): ReferenceClipAnalysis => {
  const durationSec = sampleRate > 0 ? samples.length / sampleRate : 0;
  if (samples.length === 0) return rejectAnalysis(durationSec);
  if (durationSec < MIN_REFERENCE_DURATION_SEC || durationSec > MAX_REFERENCE_DURATION_SEC) {
    return rejectAnalysis(durationSec);
  }

  const frames = analyzeFrames(samples, sampleRate);
  if (frames.length === 0) return rejectAnalysis(durationSec);

  const silenceThreshold = 800;
  const frameSec = durationSec / frames.length;
  const activeFrames = frames.filter((f) => f.rms > silenceThreshold);
  const activeSec = activeFrames.length * frameSec;
  const activityRatio = activeFrames.length / frames.length;
  if (activityRatio < 0.35) return rejectAnalysis(durationSec, activeSec);

  const meanRms = frames.reduce((sum, f) => sum + f.rms, 0) / frames.length;
  if (meanRms < 500) return rejectAnalysis(durationSec, activeSec);

  const clipRatio = frames.filter((f) => f.rms > 28_000).length / frames.length;
  const hesitationPenalty = computeHesitationPenalty(frames, silenceThreshold);
  const durationScore = scoreDuration(durationSec);
  const activityScore = Math.min(1, activityRatio / 0.75);

  return {
    durationSec,
    activeSec,
    score:
      durationScore * 40 +
      activityScore * 30 +
      Math.log10(meanRms) * 5 -
      hesitationPenalty * 25 -
      clipRatio * 20,
  };
};

/** Higher is better. Returns `-Infinity` for clips unsuitable as XTTS references. */
export const scoreReferencePcm = (samples: Int16Array, sampleRate: number): number =>
  analyzeReferencePcm(samples, sampleRate).score;

export const analyzeReferenceWav = (wavPath: string): ReferenceClipAnalysis => {
  const { samples, sampleRate } = readPcmFromWav(wavPath);
  return analyzeReferencePcm(samples, sampleRate);
};

export const scoreReferenceWav = (wavPath: string): number => analyzeReferenceWav(wavPath).score;

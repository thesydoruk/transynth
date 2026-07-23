import type { AnalysisFrame } from './analysisFrames';
import { analyzeFrames } from './analysisFrames';
import { readPcmFromWav } from './pcm';

const scoreDuration = (durationSec: number): number => {
  if (durationSec < 1 || durationSec > 14) return 0;
  const peak = 5;
  const spread = 2.5;
  return Math.exp(-((durationSec - peak) ** 2) / (2 * spread ** 2));
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

/**
 * Higher is better. Returns `-Infinity` for clips unsuitable as XTTS references.
 * Exported for unit tests.
 */
export const scoreReferencePcm = (samples: Int16Array, sampleRate: number): number => {
  if (samples.length === 0) return Number.NEGATIVE_INFINITY;

  const durationSec = samples.length / sampleRate;
  if (durationSec < 0.8 || durationSec > 14) return Number.NEGATIVE_INFINITY;

  const frames = analyzeFrames(samples, sampleRate);
  if (frames.length === 0) return Number.NEGATIVE_INFINITY;

  const silenceThreshold = 800;
  const activeFrames = frames.filter((f) => f.rms > silenceThreshold);
  const activityRatio = activeFrames.length / frames.length;
  if (activityRatio < 0.35) return Number.NEGATIVE_INFINITY;

  const meanRms = frames.reduce((sum, f) => sum + f.rms, 0) / frames.length;
  if (meanRms < 500) return Number.NEGATIVE_INFINITY;

  const clipRatio = frames.filter((f) => f.rms > 28_000).length / frames.length;
  const hesitationPenalty = computeHesitationPenalty(frames, silenceThreshold);
  const durationScore = scoreDuration(durationSec);
  const activityScore = Math.min(1, activityRatio / 0.75);

  return (
    durationScore * 40 +
    activityScore * 30 +
    Math.log10(meanRms) * 5 -
    hesitationPenalty * 25 -
    clipRatio * 20
  );
};

export const scoreReferenceWav = (wavPath: string): number => {
  const { samples, sampleRate } = readPcmFromWav(wavPath);
  return scoreReferencePcm(samples, sampleRate);
};

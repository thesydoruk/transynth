import type { EffortFeatures } from './features';

/**
 * A speaker's ordinary voice, as robust statistics over their calm clips.
 *
 * Median and MAD rather than mean and deviation, so a few shouted lines among
 * the clips do not drag the baseline up. That only holds while shouts are the
 * minority: a voice type that is mostly combat barks (the raiders — their
 * median clip sits 8 semitones above their own idle chatter) has no ordinary
 * voice in its median, and its shouts then score as ordinary. Build the
 * baseline from the lines known to be calm — greetings, idles, scenes — not
 * from every clip. On 8,030 Fallout 4 clips that moved the pooled AUC of the
 * acoustic score from 0.86 to 0.98, and the share of shouted combat lines that
 * reach the `shouting` threshold from 31 % to 93 %.
 */
export type SpeakerBaseline = {
  clipCount: number;
  f0MedianSt: RobustStat;
  brightnessDb: RobustStat;
};

type RobustStat = { median: number; spread: number };

/** How far one clip sits from its speaker's baseline, in robust z-units. */
export type EffortZScores = {
  f0Median: number;
  brightness: number;
};

/** Fewer clips than this and a per-speaker baseline is noise; pool the game instead. */
export const MIN_BASELINE_CLIPS = 8;

/** Scales MAD to a standard deviation for normally distributed data. */
const MAD_TO_SIGMA = 1.4826;
/** Floors keep a monotone speaker from turning tiny wobbles into huge z-scores. */
const MIN_SPREAD_ST = 1;
const MIN_SPREAD_DB = 1;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const robustStat = (values: number[], minSpread: number): RobustStat => {
  const center = median(values);
  const mad = median(values.map((value) => Math.abs(value - center)));
  return { median: center, spread: Math.max(minSpread, mad * MAD_TO_SIGMA) };
};

/** Baseline of one speaker's calm clips, or null when there are none. */
export const buildSpeakerBaseline = (clips: EffortFeatures[]): SpeakerBaseline | null => {
  if (clips.length === 0) return null;
  return {
    clipCount: clips.length,
    f0MedianSt: robustStat(
      clips.map((clip) => clip.f0MedianSt),
      MIN_SPREAD_ST,
    ),
    brightnessDb: robustStat(
      clips.map((clip) => clip.brightnessDb),
      MIN_SPREAD_DB,
    ),
  };
};

const z = (value: number, stat: RobustStat): number => (value - stat.median) / stat.spread;

export const effortZScores = (clip: EffortFeatures, baseline: SpeakerBaseline): EffortZScores => ({
  f0Median: z(clip.f0MedianSt, baseline.f0MedianSt),
  brightness: z(clip.brightnessDb, baseline.brightnessDb),
});

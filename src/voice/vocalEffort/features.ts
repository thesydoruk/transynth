/**
 * Acoustic cues of vocal effort in one clip — how hard the actor is pushing.
 *
 * Loudness is useless here: shipped voice files are level-normalized, so a
 * shout and a murmur carry the same RMS. What survives normalization is the
 * way the voice changes when it is raised:
 *
 *   - pitch climbs (F0 median),
 *   - the spectrum flattens, i.e. more energy sits in the high band.
 *
 * Both are only meaningful against the same speaker's ordinary speech, so the
 * numbers here are raw; `baseline.ts` turns them into z-scores per speaker.
 *
 * Measured on 8,030 original Fallout 4 clips (five voice types): the upper
 * pitch tail (p90) separates shouts worse than the median — it is where the
 * octave errors land — and brightness over every active frame scores hissed
 * lines ("Shh!", "Chicken shit.") as shouts, so it is taken over voiced frames.
 */

/** Rate the signal is decimated to before analysis; pitch needs no more. */
const ANALYSIS_RATE_HZ = 11_025;
const FRAME_SEC = 0.04;
const HOP_SEC = 0.02;
/** Shouted female lines pass 500 Hz; screams go higher still. */
const F0_MIN_HZ = 70;
const F0_MAX_HZ = 800;
/** Frame RMS (int16 scale) below this is treated as silence. */
const SILENCE_RMS = 500;
/** Normalized autocorrelation a frame needs at its pitch lag to count as voiced. */
const VOICED_CORRELATION = 0.5;
/** Take the first peak this close to the best one — the usual octave-error guard. */
const FIRST_PEAK_RATIO = 0.9;

export type EffortFeatures = {
  /** Median pitch of the voiced frames, in semitones above 100 Hz. */
  f0MedianSt: number;
  /**
   * High-band emphasis of the voiced frames in dB: energy of the first
   * difference over total energy. Unvoiced frames are left out, or sibilants
   * and breath would pass for a pushed voice.
   */
  brightnessDb: number;
  /** Voiced frames over active frames; low values mean the pitch is not to be trusted. */
  voicedRatio: number;
};

const hzToSemitones = (hz: number): number => 12 * Math.log2(hz / 100);

/** Box-filter decimation to roughly {@link ANALYSIS_RATE_HZ}. */
const decimate = (samples: Int16Array, sampleRate: number): { x: Float32Array; rate: number } => {
  const factor = Math.max(1, Math.floor(sampleRate / ANALYSIS_RATE_HZ));
  const length = Math.floor(samples.length / factor);
  const x = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += samples[i * factor + j]!;
    x[i] = sum / factor;
  }
  return { x, rate: sampleRate / factor };
};

const medianOfSorted = (sorted: number[]): number =>
  sorted.length === 0 ? Number.NaN : sorted[Math.round((sorted.length - 1) / 2)]!;

/** Pitch of one frame in Hz, or null when the frame is unvoiced. */
const framePitchHz = (
  x: Float32Array,
  start: number,
  size: number,
  rate: number,
): number | null => {
  const minLag = Math.max(2, Math.floor(rate / F0_MAX_HZ));
  const maxLag = Math.min(size - 1, Math.ceil(rate / F0_MIN_HZ));
  if (maxLag <= minLag) return null;

  let energy = 0;
  for (let i = 0; i < size; i++) energy += x[start + i]! * x[start + i]!;
  if (energy <= 0) return null;

  const corr = new Float32Array(maxLag + 1);
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let lagEnergy = 0;
    for (let i = 0; i + lag < size; i++) {
      sum += x[start + i]! * x[start + i + lag]!;
      lagEnergy += x[start + i + lag]! * x[start + i + lag]!;
    }
    const value = lagEnergy > 0 ? sum / Math.sqrt(energy * lagEnergy) : 0;
    corr[lag] = value;
    if (value > best) best = value;
  }
  if (best < VOICED_CORRELATION) return null;

  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const value = corr[lag]!;
    if (value >= best * FIRST_PEAK_RATIO && value >= corr[lag - 1]! && value >= corr[lag + 1]!) {
      return rate / lag;
    }
  }
  return null;
};

/**
 * Vocal-effort cues for a clip, or null when it holds too little speech to say.
 *
 * @example
 * const { samples, sampleRate } = readPcmFromWav(wavPath);
 * extractEffortFeatures(samples, sampleRate)?.f0MedianSt;
 */
export const extractEffortFeatures = (
  samples: Int16Array,
  sampleRate: number,
): EffortFeatures | null => {
  if (sampleRate <= 0 || samples.length === 0) return null;
  const { x, rate } = decimate(samples, sampleRate);
  const size = Math.floor(rate * FRAME_SEC);
  const hop = Math.max(1, Math.floor(rate * HOP_SEC));
  if (x.length < size) return null;

  const pitches: number[] = [];
  let activeFrames = 0;
  let energy = 0;
  let diffEnergy = 0;

  for (let start = 0; start + size <= x.length; start += hop) {
    let frameEnergy = 0;
    let frameDiff = 0;
    for (let i = 1; i < size; i++) {
      const s = x[start + i]!;
      const d = s - x[start + i - 1]!;
      frameEnergy += s * s;
      frameDiff += d * d;
    }
    if (Math.sqrt(frameEnergy / size) < SILENCE_RMS) continue;
    activeFrames += 1;

    const hz = framePitchHz(x, start, size, rate);
    if (hz == null) continue;
    pitches.push(hzToSemitones(hz));
    energy += frameEnergy;
    diffEnergy += frameDiff;
  }

  if (activeFrames < 5 || pitches.length < 3 || energy <= 0 || diffEnergy <= 0) return null;
  pitches.sort((a, b) => a - b);

  return {
    f0MedianSt: medianOfSorted(pitches),
    brightnessDb: 10 * Math.log10(diffEnergy / energy),
    voicedRatio: pitches.length / activeFrames,
  };
};

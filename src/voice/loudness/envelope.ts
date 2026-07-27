/** Sliding-window size for envelope RMS (ms). */
export const ENVELOPE_WINDOW_MS = 50;

/** Cap per-window boost so noise floors are not slammed (+12 dB). */
export const ENVELOPE_MAX_GAIN = 4;

const windowRms = (samples: Int16Array, start: number, end: number): number => {
  if (end <= start) return 0;
  let sumSq = 0;
  for (let i = start; i < end; i++) {
    const v = samples[i]!;
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / (end - start));
};

const smoothGains = (gains: Float64Array, radius: number): Float64Array => {
  if (radius <= 0 || gains.length === 0) return gains;
  const out = new Float64Array(gains.length);
  for (let i = 0; i < gains.length; i++) {
    let sum = 0;
    let count = 0;
    const from = Math.max(0, i - radius);
    const to = Math.min(gains.length - 1, i + radius);
    for (let j = from; j <= to; j++) {
      sum += gains[j]!;
      count += 1;
    }
    out[i] = sum / count;
  }
  return out;
};

/**
 * Boost quieter speech windows toward early-phrase loudness (fixes TTS end fade).
 * Does not attenuate already-loud windows; silence stays near unity gain.
 */
export const flattenSpeechEnvelope = (samples: Int16Array, sampleRate: number): Int16Array => {
  if (samples.length < sampleRate / 2) return samples;

  const win = Math.max(1, Math.floor((sampleRate * ENVELOPE_WINDOW_MS) / 1000));
  const nWindows = Math.ceil(samples.length / win);
  const rms = new Float64Array(nWindows);
  for (let w = 0; w < nWindows; w++) {
    const start = w * win;
    rms[w] = windowRms(samples, start, Math.min(samples.length, start + win));
  }

  let peakRms = 0;
  for (let w = 0; w < nWindows; w++) peakRms = Math.max(peakRms, rms[w]!);
  if (peakRms < 1) return samples;

  const silenceThr = peakRms * 0.02;
  const speechIdx: number[] = [];
  for (let w = 0; w < nWindows; w++) {
    if (rms[w]! >= silenceThr) speechIdx.push(w);
  }
  if (speechIdx.length < 4) return samples;

  const earlyCount = Math.max(1, Math.floor(speechIdx.length * 0.25));
  const early = speechIdx.slice(0, earlyCount).map((i) => rms[i]!);
  early.sort((a, b) => a - b);
  const target = early[Math.floor(early.length / 2)]!;
  if (target < 1) return samples;

  const gains = new Float64Array(nWindows);
  for (let w = 0; w < nWindows; w++) {
    const r = rms[w]!;
    if (r < silenceThr) {
      gains[w] = 1;
    } else {
      gains[w] = Math.min(ENVELOPE_MAX_GAIN, Math.max(1, target / r));
    }
  }
  const smoothed = smoothGains(gains, 2);

  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const w = Math.min(nWindows - 1, Math.floor(i / win));
    const next = Math.min(nWindows - 1, w + 1);
    const frac = (i - w * win) / win;
    const gain = smoothed[w]! * (1 - frac) + smoothed[next]! * frac;
    const v = Math.round(samples[i]! * gain);
    out[i] = Math.max(-32768, Math.min(32767, v));
  }
  return out;
};

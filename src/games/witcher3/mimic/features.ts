/**
 * What the mouth model hears: a log-mel spectrum at every animation frame.
 *
 * One 25 ms Hann window per lip frame, centred on the frame's time, 40 mel
 * bands up to 8 kHz. Each frame's vector is the line's spectrum minus the
 * line's own mean (so loudness and microphone colour drop out — a synthesized
 * Ukrainian take and a studio English one meet on the same scale), stacked
 * with its neighbours ±`context` frames: the mouth moves ahead of the sound
 * and lingers after it.
 *
 * The same code builds training data from the game's takes and features for a
 * new take, which is what keeps the two in step.
 */

export const MIMIC_SAMPLE_RATE = 16000;
export const MIMIC_MEL_BANDS = 40;
const WINDOW = 400;
const FFT_SIZE = 512;
const MAX_HZ = 8000;

const hzToMel = (hz: number): number => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel: number): number => 700 * (10 ** (mel / 2595) - 1);

const MEL_BINS = Array.from({ length: MIMIC_MEL_BANDS + 2 }, (_, i) =>
  Math.floor(
    ((FFT_SIZE + 1) * melToHz((hzToMel(MAX_HZ) * i) / (MIMIC_MEL_BANDS + 1))) / MIMIC_SAMPLE_RATE,
  ),
);
const HANN = Float64Array.from(
  { length: WINDOW },
  (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW - 1)),
);

/** In-place radix-2 FFT. */
const fft = (re: Float64Array, im: Float64Array): void => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const vr = re[b]! * cr - im[b]! * ci;
        const vi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - vr;
        im[b] = im[a]! - vi;
        re[a] = re[a]! + vr;
        im[a] = im[a]! + vi;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
};

/** Log-mel energies of the window centred at `seconds`. */
const logMelAt = (pcm: Float32Array, seconds: number, out: Float32Array, offset: number): void => {
  const centre = Math.round(seconds * MIMIC_SAMPLE_RATE);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < WINDOW; i++) {
    const s = centre - WINDOW / 2 + i;
    re[i] = (s >= 0 && s < pcm.length ? pcm[s]! : 0) * HANN[i]!;
  }
  fft(re, im);
  for (let m = 0; m < MIMIC_MEL_BANDS; m++) {
    const lo = MEL_BINS[m]!;
    const mid = MEL_BINS[m + 1]!;
    const hi = MEL_BINS[m + 2]!;
    let energy = 0;
    for (let k = lo; k < hi; k++) {
      const weight = k < mid ? (k - lo) / Math.max(1, mid - lo) : (hi - k) / Math.max(1, hi - mid);
      energy += weight * (re[k]! ** 2 + im[k]! ** 2);
    }
    out[offset + m] = Math.log(energy + 1e-6);
  }
};

/** Per-frame log-mel spectra, mean-normalized over the line: `frames × MIMIC_MEL_BANDS`. */
export const frameSpectra = (pcm: Float32Array, frames: number, dt: number): Float32Array => {
  const out = new Float32Array(frames * MIMIC_MEL_BANDS);
  for (let f = 0; f < frames; f++) logMelAt(pcm, f * dt, out, f * MIMIC_MEL_BANDS);
  for (let m = 0; m < MIMIC_MEL_BANDS; m++) {
    let mean = 0;
    for (let f = 0; f < frames; f++) mean += out[f * MIMIC_MEL_BANDS + m]!;
    mean /= Math.max(1, frames);
    for (let f = 0; f < frames; f++) out[f * MIMIC_MEL_BANDS + m]! -= mean;
  }
  return out;
};

/** Frame `f`'s input vector: spectra of frames f-context … f+context, clamped at the ends. */
export const contextWindow = (
  spectra: Float32Array,
  frames: number,
  f: number,
  context: number,
  out: Float32Array,
): void => {
  let pos = 0;
  for (let c = -context; c <= context; c++) {
    const src = Math.min(frames - 1, Math.max(0, f + c)) * MIMIC_MEL_BANDS;
    for (let m = 0; m < MIMIC_MEL_BANDS; m++) out[pos++] = spectra[src + m]!;
  }
};

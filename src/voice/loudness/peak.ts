/** Absolute peak of int16 PCM (0 if empty). */
export const measurePeak = (samples: Int16Array): number => {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]!);
    if (a > peak) peak = a;
  }
  return peak;
};

/**
 * Scale samples so their peak matches `targetPeak` (clamped to int16 range).
 * No-op when either peak is near zero.
 */
export const matchPeakToTarget = (samples: Int16Array, targetPeak: number): Int16Array => {
  const current = measurePeak(samples);
  const safeTarget = Math.max(0, Math.min(32767, Math.round(targetPeak)));
  if (current < 1 || safeTarget < 1) return samples;

  const scale = safeTarget / current;
  if (Math.abs(scale - 1) < 0.001) return samples;

  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.round(samples[i]! * scale);
    out[i] = Math.max(-32768, Math.min(32767, v));
  }
  return out;
};

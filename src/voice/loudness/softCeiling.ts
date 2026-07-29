/** Samples below this share of the ceiling are scaled linearly. */
const KNEE_RATIO = 0.7;

/**
 * Scale samples by `gain`, rounding off anything that would pass the ceiling.
 *
 * Matching speech level raises the body of a line, which pushes its sharpest
 * transients past full scale. Scaling the whole line down to fit them would undo
 * the level match, so only the excess above the knee is compressed — the curve
 * approaches the ceiling asymptotically, so the result never clips.
 */
export const scaleWithSoftCeiling = (
  samples: Int16Array,
  gain: number,
  ceiling: number,
): Int16Array => {
  const limit = Math.max(1, Math.min(32_767, Math.round(ceiling)));
  const knee = limit * KNEE_RATIO;
  const range = limit - knee;

  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const scaled = samples[i]! * gain;
    const magnitude = Math.abs(scaled);
    const shaped =
      magnitude <= knee ? magnitude : knee + range * Math.tanh((magnitude - knee) / range);
    const value = Math.round(scaled < 0 ? -shaped : shaped);
    out[i] = Math.max(-32_768, Math.min(32_767, value));
  }
  return out;
};

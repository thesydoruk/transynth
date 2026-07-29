/** Sliding-window size for speech level measurement (ms). */
const WINDOW_MS = 50;

/** Windows quieter than this share of the loudest window count as silence. */
const SPEECH_FLOOR_RATIO = 0.1;

/**
 * RMS of the active speech in mono PCM, ignoring the silence between phrases.
 *
 * Perceived level has to be compared over speech only: the same phrase measured
 * with its leading and trailing silence looks quieter the longer those pauses
 * are, which would make every level match depend on line padding.
 */
export const measureSpeechRms = (samples: Int16Array, sampleRate: number): number => {
  if (samples.length === 0 || sampleRate <= 0) return 0;

  const win = Math.max(1, Math.floor((sampleRate * WINDOW_MS) / 1000));
  const nWindows = Math.ceil(samples.length / win);
  const sumSq = new Float64Array(nWindows);
  const counts = new Int32Array(nWindows);
  for (let i = 0; i < samples.length; i++) {
    const w = Math.floor(i / win);
    const v = samples[i]!;
    sumSq[w] += v * v;
    counts[w] += 1;
  }

  const rms = new Float64Array(nWindows);
  let peakRms = 0;
  for (let w = 0; w < nWindows; w++) {
    rms[w] = Math.sqrt(sumSq[w]! / Math.max(1, counts[w]!));
    if (rms[w]! > peakRms) peakRms = rms[w]!;
  }
  if (peakRms < 1) return 0;

  const floor = peakRms * SPEECH_FLOOR_RATIO;
  let activeSumSq = 0;
  let activeCount = 0;
  for (let w = 0; w < nWindows; w++) {
    if (rms[w]! < floor) continue;
    activeSumSq += sumSq[w]!;
    activeCount += counts[w]!;
  }
  return activeCount > 0 ? Math.sqrt(activeSumSq / activeCount) : 0;
};

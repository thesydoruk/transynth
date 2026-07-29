import { readPcmFromWav } from '../speakerReference/pcm';
import { flattenSpeechEnvelope } from './envelope';
import { matchPeakToTarget, measurePeak } from './peak';
import { scaleWithSoftCeiling } from './softCeiling';
import { measureSpeechRms } from './speechRms';
import { writePcmWav } from './writePcmWav';

/** How far a transient may rise above the English peak (+4 dB). */
const PEAK_ALLOWANCE = 1.6;

/** Never come closer than ~0.2 dB to full scale. */
const ABSOLUTE_CEILING = 32_000;

/** Largest correction applied to reach the English speech level (+12 dB). */
const MAX_GAIN = 4;

/** Stop the corrective pass once the level is within ~0.3 dB of the target. */
const GAIN_TOLERANCE = 1.035;

/**
 * Bring the speech level of a synthesized line to its English original.
 *
 * Peaks alone are not enough: a peak match makes one transient equal while the
 * body of a long Ukrainian line stays up to 6 dB quieter than the English one,
 * which is audible when lines play back to back. The level is therefore matched
 * on speech RMS, and the transients that the gain lifts past the ceiling are
 * rounded off instead of scaling the whole line back down.
 */
const matchSpeechLevel = (
  samples: Int16Array,
  sampleRate: number,
  targetRms: number,
  ceiling: number,
): Int16Array => {
  const currentRms = measureSpeechRms(samples, sampleRate);
  if (currentRms < 1) return samples;

  const gain = Math.min(MAX_GAIN, targetRms / currentRms);
  const matched = scaleWithSoftCeiling(samples, gain, ceiling);

  // Compressing the transients also lowers the measured level, so one more pass
  // closes the gap left by the first.
  const matchedRms = measureSpeechRms(matched, sampleRate);
  if (matchedRms < 1 || targetRms / matchedRms < GAIN_TOLERANCE) return matched;

  return scaleWithSoftCeiling(matched, Math.min(MAX_GAIN, targetRms / matchedRms), ceiling);
};

/**
 * Flatten TTS end-fade, then match speech loudness to the English line.
 * Operates on mono 16-bit WAV paths; writes `ttsWavPath` in place.
 */
export const matchTtsLoudnessToEnglish = (ttsWavPath: string, englishWavPath: string): void => {
  const tts = readPcmFromWav(ttsWavPath);
  const english = readPcmFromWav(englishWavPath);

  const flattened = flattenSpeechEnvelope(tts.samples, tts.sampleRate);
  const englishPeak = measurePeak(english.samples);
  const englishRms = measureSpeechRms(english.samples, english.sampleRate);

  let matched = flattened;
  if (englishRms >= 1) {
    const ceiling = Math.min(ABSOLUTE_CEILING, englishPeak * PEAK_ALLOWANCE);
    matched = matchSpeechLevel(flattened, tts.sampleRate, englishRms, ceiling);
  } else if (englishPeak > 0) {
    matched = matchPeakToTarget(flattened, englishPeak);
  }

  writePcmWav(ttsWavPath, matched, tts.sampleRate);
};

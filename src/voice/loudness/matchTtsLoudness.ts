import { readPcmFromWav } from '../speakerReference/pcm';
import { flattenSpeechEnvelope } from './envelope';
import { matchPeakToTarget, measurePeak } from './peak';
import { writePcmWav } from './writePcmWav';

/**
 * Flatten TTS end-fade, then match peak loudness to the English line reference.
 * Operates on mono 16-bit WAV paths; writes `ttsWavPath` in place.
 */
export const matchTtsLoudnessToEnglish = (ttsWavPath: string, englishWavPath: string): void => {
  const tts = readPcmFromWav(ttsWavPath);
  const english = readPcmFromWav(englishWavPath);

  const flattened = flattenSpeechEnvelope(tts.samples, tts.sampleRate);
  const englishPeak = measurePeak(english.samples);
  const matched = englishPeak > 0 ? matchPeakToTarget(flattened, englishPeak) : flattened;

  writePcmWav(ttsWavPath, matched, tts.sampleRate);
};

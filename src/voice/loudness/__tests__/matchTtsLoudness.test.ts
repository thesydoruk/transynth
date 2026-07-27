import { flattenSpeechEnvelope } from '../envelope';
import { matchPeakToTarget, measurePeak } from '../peak';

const SAMPLE_RATE = 22_050;

const tone = (durationSec: number, amp: number, freq = 220): Int16Array => {
  const n = Math.floor(SAMPLE_RATE * durationSec);
  const samples = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    samples[i] = Math.round(amp * Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE));
  }
  return samples;
};

const rms = (samples: Int16Array, start: number, end: number): number => {
  let sum = 0;
  for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / Math.max(1, end - start));
};

describe('flattenSpeechEnvelope', () => {
  it('boosts a faded ending toward early loudness', () => {
    const first = tone(1.0, 8000);
    const last = tone(1.0, 2000);
    const faded = new Int16Array(first.length + last.length);
    faded.set(first, 0);
    faded.set(last, first.length);

    const fixed = flattenSpeechEnvelope(faded, SAMPLE_RATE);
    const mid = Math.floor(fixed.length / 2);
    const earlyRms = rms(fixed, 0, mid);
    const lateRms = rms(fixed, mid, fixed.length);

    expect(lateRms / earlyRms).toBeGreaterThan(0.7);
    expect(measurePeak(fixed)).toBeGreaterThanOrEqual(measurePeak(faded) * 0.95);
  });

  it('leaves short clips unchanged', () => {
    const short = tone(0.2, 5000);
    const out = flattenSpeechEnvelope(short, SAMPLE_RATE);
    expect(out).toBe(short);
  });
});

describe('matchPeakToTarget', () => {
  it('scales peak to the English reference peak', () => {
    const tts = tone(0.5, 4000);
    const matched = matchPeakToTarget(tts, 12_000);
    expect(measurePeak(matched)).toBe(12_000);
  });

  it('scales down when TTS is louder than English', () => {
    const tts = tone(0.5, 20_000);
    const matched = matchPeakToTarget(tts, 8_000);
    expect(measurePeak(matched)).toBe(8_000);
  });
});

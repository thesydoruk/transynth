import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPcmFromWav } from '../../speakerReference/pcm';
import { flattenSpeechEnvelope } from '../envelope';
import { matchTtsLoudnessToEnglish } from '../matchTtsLoudness';
import { matchPeakToTarget, measurePeak } from '../peak';
import { scaleWithSoftCeiling } from '../softCeiling';
import { measureSpeechRms } from '../speechRms';
import { writePcmWav } from '../writePcmWav';

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

const concat = (...parts: Int16Array[]): Int16Array => {
  const out = new Int16Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const dbBetween = (value: number, reference: number): number => 20 * Math.log10(value / reference);

describe('measureSpeechRms', () => {
  it('ignores pauses so padding does not lower the level', () => {
    const speech = tone(1, 8000);
    const padded = concat(speech, new Int16Array(SAMPLE_RATE), speech);

    const speechRms = measureSpeechRms(speech, SAMPLE_RATE);
    expect(Math.abs(dbBetween(measureSpeechRms(padded, SAMPLE_RATE), speechRms))).toBeLessThan(0.5);
    expect(speechRms).toBeCloseTo(8000 / Math.SQRT2, -1);
  });

  it('returns zero for silence', () => {
    expect(measureSpeechRms(new Int16Array(SAMPLE_RATE), SAMPLE_RATE)).toBe(0);
  });
});

describe('scaleWithSoftCeiling', () => {
  it('keeps the loudest sample within the ceiling', () => {
    const loud = concat(tone(0.2, 12_000), tone(0.01, 30_000));
    const scaled = scaleWithSoftCeiling(loud, 3, 32_000);
    expect(measurePeak(scaled)).toBeLessThanOrEqual(32_000);
  });

  it('scales samples under the knee linearly', () => {
    const quiet = tone(0.2, 4000);
    const scaled = scaleWithSoftCeiling(quiet, 2, 32_000);
    expect(measurePeak(scaled)).toBe(8000);
  });
});

describe('matchTtsLoudnessToEnglish', () => {
  const writeWav = (dir: string, name: string, samples: Int16Array): string => {
    const wavPath = path.join(dir, name);
    writePcmWav(wavPath, samples, SAMPLE_RATE);
    return wavPath;
  };

  it('matches speech level even when the line has sharp transients', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loudness-'));
    const english = writeWav(dir, 'en.wav', tone(2, 9000));
    // Quiet body with a transient far above it — a peak match would leave the
    // body ~10 dB below the English line.
    const ttsPath = writeWav(dir, 'uk.wav', concat(tone(2, 3000), tone(0.02, 22_000)));

    matchTtsLoudnessToEnglish(ttsPath, english);
    const matched = readPcmFromWav(ttsPath);

    const targetRms = measureSpeechRms(tone(2, 9000), SAMPLE_RATE);
    const matchedRms = measureSpeechRms(matched.samples, SAMPLE_RATE);
    expect(Math.abs(dbBetween(matchedRms, targetRms))).toBeLessThan(1);
    expect(measurePeak(matched.samples)).toBeLessThanOrEqual(32_000);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('brings a line that is too loud back down', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loudness-'));
    const english = writeWav(dir, 'en.wav', tone(2, 4000));
    const ttsPath = writeWav(dir, 'uk.wav', tone(2, 20_000));

    matchTtsLoudnessToEnglish(ttsPath, english);
    const matched = readPcmFromWav(ttsPath);

    const targetRms = measureSpeechRms(tone(2, 4000), SAMPLE_RATE);
    const matchedRms = measureSpeechRms(matched.samples, SAMPLE_RATE);
    expect(Math.abs(dbBetween(matchedRms, targetRms))).toBeLessThan(0.5);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

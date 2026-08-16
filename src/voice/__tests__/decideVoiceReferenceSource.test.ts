import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  decideVoiceReferenceSource,
  isLineReferenceSuitable,
  isLineReferenceTooLong,
  type VoiceReferenceSourceDecision,
} from '../decideVoiceReferenceSource';
import { MAX_REFERENCE_DURATION_SEC } from '../speakerReference/constants';

const SAMPLE_RATE = 22_050;

const writeTestWav = (filePath: string, samples: Int16Array): void => {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(samples[i]!, 44 + i * 2);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
};

const makeSpeechLike = (durationSec: number): Int16Array => {
  const count = Math.floor(SAMPLE_RATE * durationSec);
  const samples = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / SAMPLE_RATE;
    const amp = 6000 + 2000 * Math.sin(t * 3.7);
    samples[i] = Math.round(amp * Math.sin(2 * Math.PI * (180 + 40 * Math.sin(t * 5)) * t));
  }
  return samples;
};

describe('decideVoiceReferenceSource', () => {
  it('uses speaker mode whenever project mode is speaker', () => {
    expect(decideVoiceReferenceSource('speaker', true)).toEqual({
      kind: 'speaker',
      reason: 'mode',
    });
    expect(decideVoiceReferenceSource('speaker', false)).toEqual({
      kind: 'speaker',
      reason: 'mode',
    });
  });

  it('keeps line mode when the line clip is suitable', () => {
    expect(decideVoiceReferenceSource('line', true)).toEqual({ kind: 'line' });
  });

  it('falls back to speaker when the line is unsuitable', () => {
    const decision: VoiceReferenceSourceDecision = decideVoiceReferenceSource('line', false);
    expect(decision).toEqual({ kind: 'speaker', reason: 'line_unsuitable' });
  });

  it('falls back to the default speaker reference when the line is too long', () => {
    expect(decideVoiceReferenceSource('line', false, true)).toEqual({
      kind: 'speaker',
      reason: 'line_too_long',
    });
  });
});

describe('isLineReferenceTooLong', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-ref-len-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects clips longer than the Fish Speech reference cap', () => {
    const wavPath = path.join(tmpDir, 'long.wav');
    writeTestWav(wavPath, makeSpeechLike(MAX_REFERENCE_DURATION_SEC + 0.5));
    expect(isLineReferenceTooLong(wavPath)).toBe(true);
    expect(isLineReferenceSuitable(wavPath)).toBe(false);
  });

  it('accepts a medium-length speech clip', () => {
    const wavPath = path.join(tmpDir, 'ok.wav');
    writeTestWav(wavPath, makeSpeechLike(5));
    expect(isLineReferenceTooLong(wavPath)).toBe(false);
    expect(isLineReferenceSuitable(wavPath)).toBe(true);
  });

  it('rejects a clip that is too short to clone from', () => {
    const wavPath = path.join(tmpDir, 'short.wav');
    writeTestWav(wavPath, makeSpeechLike(0.4));
    expect(isLineReferenceTooLong(wavPath)).toBe(false);
    expect(isLineReferenceSuitable(wavPath)).toBe(false);
  });
});

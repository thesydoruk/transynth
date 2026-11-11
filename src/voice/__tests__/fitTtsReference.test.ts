import { afterAll, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  padShortClips,
  TTS_REFERENCE_MAX_SEC,
  TTS_REFERENCE_MIN_SEC,
  trimmedLineClip,
  writeWavOfLength,
} from '../fitTtsReference';
import { readPcmFromWav, wavDurationSec } from '../speakerReference/pcm';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-tts-ref-'));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const SAMPLE_RATE = 22_050;
const wav = (name: string, seconds: number): string => {
  const samples = Math.round(SAMPLE_RATE * seconds);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
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
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(1000, 44 + i * 2);
  const file = path.join(tmpDir, `${name}.wav`);
  fs.writeFileSync(file, buffer);
  return file;
};

describe('fitTtsReference', () => {
  it('cuts an over-long take to the server limit and drops its transcript', () => {
    const clip = trimmedLineClip({
      wavPath: wav('long', 33),
      speakerText: 'Long line',
      fileName: 'x',
    });
    expect(wavDurationSec(clip.wavPath)).toBeCloseTo(TTS_REFERENCE_MAX_SEC, 2);
    expect(clip.speakerText).toBe('');
  });

  it('pads a lone short take with silence, keeping its audio first', () => {
    const [clip] = padShortClips([{ wavPath: wav('short', 1), speakerText: 'Hi.', fileName: 'x' }]);
    expect(wavDurationSec(clip!.wavPath)).toBeGreaterThanOrEqual(TTS_REFERENCE_MIN_SEC);
    const { samples } = readPcmFromWav(clip!.wavPath);
    expect(samples[0]).toBe(1000);
    expect(samples[samples.length - 1]).toBe(0);
    expect(clip!.speakerText).toBe('Hi.');
  });

  it('leaves clips that are long enough together', () => {
    const clips = [
      { wavPath: wav('a', 0.8), speakerText: null, fileName: 'a' },
      { wavPath: wav('b', 2), speakerText: null, fileName: 'b' },
    ];
    expect(padShortClips(clips)).toBe(clips);
  });

  it('writes a copy next to the source', () => {
    const src = wav('copy', 2);
    const out = writeWavOfLength(src, 1, 'cut');
    expect(path.dirname(out)).toBe(tmpDir);
    expect(wavDurationSec(src)).toBeCloseTo(2, 2);
  });
});

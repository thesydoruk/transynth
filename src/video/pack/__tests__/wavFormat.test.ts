import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertBinkSound, readWavFormat } from '../wavFormat';

/** A minimal RIFF/WAVE header with the given `fmt ` chunk. */
const wavHeader = (sampleRate: number, bits = 16, formatTag = 1): Buffer => {
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(formatTag, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(0, 40);
  return buf;
};

describe('the WAV check before BinkMix', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wavfmt-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('accepts 48 kHz 16-bit PCM and refuses what the game would play as silence', () => {
    const ok = path.join(dir, 'ok.wav');
    const hi = path.join(dir, 'hi.wav');
    const float = path.join(dir, 'f.wav');
    const junk = path.join(dir, 'x.bin');
    fs.writeFileSync(ok, wavHeader(48000));
    fs.writeFileSync(hi, wavHeader(192000));
    fs.writeFileSync(float, wavHeader(48000, 32, 3));
    fs.writeFileSync(junk, 'nope');
    expect(readWavFormat(ok)).toEqual({ formatTag: 1, channels: 2, sampleRate: 48000, bits: 16 });
    expect(readWavFormat(junk)).toBeNull();
    expect(() => assertBinkSound(ok)).not.toThrow();
    expect(() => assertBinkSound(hi)).toThrow(/192000 Hz/);
    expect(() => assertBinkSound(float)).toThrow(/not 16-bit PCM/);
    expect(() => assertBinkSound(junk)).toThrow(/not a RIFF/);
  });
});

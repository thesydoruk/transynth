import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  binkMixArgs,
  binkSoundProblem,
  parseTrackIds,
  readWavFormat,
  replaceBinkTracks,
} from '../binkMix';

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

describe('binkmix', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binkmix-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads the WAV format and refuses what Bink would turn into silence', () => {
    const ok = path.join(dir, 'ok.wav');
    const hi = path.join(dir, 'hi.wav');
    const float = path.join(dir, 'f.wav');
    fs.writeFileSync(ok, wavHeader(48000));
    fs.writeFileSync(hi, wavHeader(192000));
    fs.writeFileSync(float, wavHeader(48000, 32, 3));
    fs.writeFileSync(path.join(dir, 'x.bin'), 'nope');
    expect(readWavFormat(ok)).toEqual({ formatTag: 1, channels: 2, sampleRate: 48000, bits: 16 });
    expect(binkSoundProblem(ok)).toBeNull();
    expect(binkSoundProblem(hi)).toMatch(/192000 Hz/);
    expect(binkSoundProblem(float)).toMatch(/not 16-bit PCM/);
    expect(binkSoundProblem(path.join(dir, 'x.bin'))).toMatch(/not a RIFF/);
  });

  it('parses track ids from the form field', () => {
    expect(parseTrackIds('0,1')).toEqual([0, 1]);
    expect(parseTrackIds(' 1, 1 ,5')).toEqual([1, 5]);
    expect(parseTrackIds('')).toBeNull();
    expect(parseTrackIds('a')).toBeNull();
    expect(parseTrackIds(undefined)).toBeNull();
  });

  it('runs one pass per track, each reading the previous output, with Windows paths', async () => {
    const input = path.join(dir, 'in.bk2');
    const sound = path.join(dir, 's.wav');
    const output = path.join(dir, 'out.bk2');
    fs.writeFileSync(input, 'video');
    fs.writeFileSync(sound, wavHeader(48000));
    const calls: string[][] = [];
    await replaceBinkTracks({
      exe: '/opt/bethesda/radvideo64.exe',
      inputBk2: input,
      soundWav: sound,
      outputBk2: output,
      trackIds: [0, 1],
      workDir: dir,
      timeoutMs: 1000,
      run: async (args) => {
        calls.push(args);
        fs.writeFileSync(args[4]!.replace(/^Z:/, '').replace(/\\/g, '/'), 'mixed');
      },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.slice(0, 2)).toEqual(['/opt/bethesda/radvideo64.exe', 'BinkMix']);
    expect(calls[0]![2]).toMatch(/^Z:.*\\in\.bk2$/);
    expect(calls[0]![5]).toBe('/TrackID0');
    expect(calls[1]![2]).toMatch(/\\mix-0\.bk2$/);
    expect(calls[1]![4]).toMatch(/\\out\.bk2$/);
    expect(calls[1]!.slice(5)).toEqual([
      '/TrackID1',
      '/SoundCompress4',
      '/Overwrite',
      '/AutoClose',
    ]);
    expect(fs.existsSync(output)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'mix-0.bk2'))).toBe(false);
  });

  it('fails when a pass leaves no output (the tool showed a dialog instead)', async () => {
    const input = path.join(dir, 'in.bk2');
    const sound = path.join(dir, 's.wav');
    fs.writeFileSync(input, 'video');
    fs.writeFileSync(sound, wavHeader(48000));
    await expect(
      replaceBinkTracks({
        exe: 'radvideo64.exe',
        inputBk2: input,
        soundWav: sound,
        outputBk2: path.join(dir, 'out.bk2'),
        trackIds: [0],
        workDir: dir,
        timeoutMs: 1000,
        run: async () => undefined,
      }),
    ).rejects.toThrow('left no output for track 0');
    expect(binkMixArgs('x.exe', '/a/in.bk2', '/a/s.wav', '/a/out.bk2', 3)[5]).toBe('/TrackID3');
  });
});

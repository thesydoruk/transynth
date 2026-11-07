import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertBinkSound, binkMixArgs, readWavFormat, replaceBinkTracks } from '../binkMix';

/** A WAV with no audio, the header the way ffmpeg writes it. */
const wavHeader = (
  sampleRate: number,
  opts: { bits?: number; formatTag?: number } = {},
): Buffer => {
  const bits = opts.bits ?? 16;
  const channels = 2;
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(opts.formatTag ?? 1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE((sampleRate * channels * bits) / 8, 28);
  buf.writeUInt16LE((channels * bits) / 8, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(0, 40);
  return buf;
};

describe('binkmix', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'binkmix-'));
    fs.writeFileSync(path.join(dir, 'Intro.bk2'), 'bink');
    fs.writeFileSync(path.join(dir, 'dub.wav'), 'wav');
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('builds the mixer command the way RAD documents it', () => {
    expect(binkMixArgs('in.bk2', 'dub.wav', 'out.bk2', 3)).toEqual([
      'BinkMix',
      'in.bk2',
      'dub.wav',
      'out.bk2',
      '/TrackID3',
      '/SoundCompress4',
      '/Overwrite',
      '/AutoClose',
    ]);
  });

  it('mixes one track per pass, each reading the previous output, and ends at the target file', async () => {
    const passes: string[][] = [];
    await replaceBinkTracks({
      radVideoExe: 'radvideo64.exe',
      inputBk2: path.join(dir, 'Intro.bk2'),
      soundWav: path.join(dir, 'dub.wav'),
      outputBk2: path.join(dir, 'out', 'Intro.bk2'),
      trackIds: [1, 2, 3],
      workDir: path.join(dir, 'work'),
      run: async (_exe, args) => {
        passes.push(args);
        fs.writeFileSync(args[3]!, `mixed ${args[4]}`);
      },
    });
    expect(passes.map((a) => [path.basename(a[1]!), path.basename(a[3]!), a[4]])).toEqual([
      ['Intro.bk2', 'mix-0.bk2', '/TrackID1'],
      ['mix-0.bk2', 'mix-1.bk2', '/TrackID2'],
      ['mix-1.bk2', 'Intro.bk2', '/TrackID3'],
    ]);
    expect(fs.readFileSync(path.join(dir, 'out', 'Intro.bk2'), 'utf8')).toBe('mixed /TrackID3');
    expect(fs.readdirSync(path.join(dir, 'work'))).toEqual([]);
    // The game's own file is never touched.
    expect(fs.readFileSync(path.join(dir, 'Intro.bk2'), 'utf8')).toBe('bink');
  });

  it('reads the format of a WAV and leaves other files to the mixer', () => {
    const wav = path.join(dir, 'fmt.wav');
    fs.writeFileSync(wav, wavHeader(48000));
    expect(readWavFormat(wav)).toEqual({ formatTag: 1, channels: 2, sampleRate: 48000, bits: 16 });
    expect(readWavFormat(path.join(dir, 'dub.wav'))).toBeNull();
    expect(() => assertBinkSound(path.join(dir, 'dub.wav'))).not.toThrow();
  });

  it('refuses the 192 kHz WAV loudnorm leaves behind: Bink keeps the rate in 16 bits', async () => {
    const wav = path.join(dir, 'dub192.wav');
    fs.writeFileSync(wav, wavHeader(192000, { formatTag: 0xfffe }));
    expect(() => assertBinkSound(wav)).toThrow(/192000 Hz WAV.*48 kHz/);
    fs.writeFileSync(path.join(dir, 'float.wav'), wavHeader(48000, { bits: 32, formatTag: 3 }));
    expect(() => assertBinkSound(path.join(dir, 'float.wav'))).toThrow(/not 16-bit PCM/);
    const passes: string[][] = [];
    await expect(
      replaceBinkTracks({
        radVideoExe: 'radvideo64.exe',
        inputBk2: path.join(dir, 'Intro.bk2'),
        soundWav: wav,
        outputBk2: path.join(dir, 'out.bk2'),
        trackIds: [0],
        workDir: path.join(dir, 'work'),
        run: async (_exe, args) => {
          passes.push(args);
        },
      }),
    ).rejects.toThrow(/192000 Hz/);
    expect(passes).toEqual([]);
  });

  it('fails when a pass exits without writing its output', async () => {
    await expect(
      replaceBinkTracks({
        radVideoExe: 'radvideo64.exe',
        inputBk2: path.join(dir, 'Intro.bk2'),
        soundWav: path.join(dir, 'dub.wav'),
        outputBk2: path.join(dir, 'out.bk2'),
        trackIds: [0],
        workDir: path.join(dir, 'work'),
        run: async () => undefined,
      }),
    ).rejects.toThrow(/no output for track 0/);
  });
});

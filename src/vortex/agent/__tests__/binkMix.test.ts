import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { binkMixArgs, replaceBinkTracks } from '../binkMix';

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

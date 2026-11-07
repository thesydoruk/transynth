import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packVideos, videopackFileName, type VideoPackState } from '../videoPack';

const media = { videoDir: 'Data/Video', videoExtensions: ['.bk2'], packDir: 'Video' };

describe('videopack', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'videopack-'));
    fs.mkdirSync(path.join(root, 'game', 'Data', 'Video'), { recursive: true });
    fs.writeFileSync(path.join(root, 'game', 'Data', 'Video', 'Intro_ru.bk2'), 'intro');
    fs.writeFileSync(path.join(root, 'game', 'Data', 'Video', 'STRENGTH.bk2'), 'strength');
    fs.writeFileSync(
      path.join(root, 'game', 'Data', 'Video', 'Intro_ru.bk2.vortex_backup'),
      'orig',
    );
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes each pending dub into every track of its video, reports it, and ships one archive', async () => {
    const calls: string[] = [];
    const state: VideoPackState = { packedVideos: { 'STRENGTH.bk2': 'v-old' }, videopackSeq: 2 };
    const outcome = await packVideos({
      game: 'fo4',
      tgtLang: 'uk',
      gameDir: path.join(root, 'game'),
      media,
      tasks: [
        { videoId: 1, fileName: 'Intro_ru.bk2', dubVersion: 'v1', byteSize: 3 },
        { videoId: 2, fileName: 'STRENGTH.bk2', dubVersion: 'v-old', byteSize: null },
        { videoId: 3, fileName: 'Gone.bk2', dubVersion: 'v3', byteSize: null },
      ],
      api: {
        downloadVideoDub: async (_g, id, dest) => {
          calls.push(`download #${id}`);
          fs.writeFileSync(dest, 'wav');
          return 3;
        },
        postVideoPacked: async (_g, id, body) => {
          calls.push(`packed #${id} ${body.dubVersion}`);
        },
      },
      radVideoExe: 'radvideo64.exe',
      ffprobePath: 'ffprobe',
      packDir: path.join(root, 'pack'),
      downloadsDir: path.join(root, 'downloads'),
      state,
      ownNames: new Set(['intro_ru.bk2']),
      probe: async () => ({
        durationS: 10,
        tracks: [
          { id: 0, streamIndex: 1 },
          { id: 1, streamIndex: 2 },
        ],
      }),
      mix: async (opts) => {
        calls.push(`mix ${path.basename(opts.inputBk2)} tracks ${opts.trackIds.join(',')}`);
        // The deployed file is our previous dub: the mix starts from Vortex's backup of the game file.
        expect(fs.readFileSync(opts.inputBk2, 'utf8')).toBe('orig');
        fs.mkdirSync(path.dirname(opts.outputBk2), { recursive: true });
        fs.writeFileSync(opts.outputBk2, 'dubbed');
      },
      zip: async (srcDir, dest) => {
        calls.push(`zip ${path.relative(root, srcDir)} -> ${path.basename(dest)}`);
        fs.writeFileSync(dest, 'zip');
        return 3;
      },
    });

    expect(outcome).toEqual({
      written: 1,
      skipped: 2,
      zipFile: 'Transynth_fo4_uk_videopack_r3.zip',
    });
    expect(calls).toEqual([
      'download #1',
      'mix Intro_ru.bk2.vortex_backup tracks 0,1',
      'packed #1 v1',
      // Written in an earlier tick: the server is told again, nothing is mixed.
      'packed #2 v-old',
      'zip pack -> Transynth_fo4_uk_videopack_r3.zip.part',
    ]);
    expect(fs.readdirSync(path.join(root, 'downloads'))).toEqual([
      'Transynth_fo4_uk_videopack_r3.zip',
    ]);
    expect(fs.readFileSync(path.join(root, 'pack', 'Video', 'Intro_ru.bk2'), 'utf8')).toBe(
      'dubbed',
    );
    expect(state).toEqual({
      packedVideos: { 'STRENGTH.bk2': 'v-old', 'Intro_ru.bk2': 'v1' },
      videopackSeq: 3,
    });
    expect(videopackFileName('fo4', 'uk', 7)).toBe('Transynth_fo4_uk_videopack_r7.zip');
  });

  it('ships nothing when every dub is already in place, and still reports it', async () => {
    const reported: string[] = [];
    const outcome = await packVideos({
      game: 'fo4',
      tgtLang: 'uk',
      gameDir: path.join(root, 'game'),
      media,
      tasks: [{ videoId: 1, fileName: 'Intro_ru.bk2', dubVersion: 'v1', byteSize: null }],
      api: {
        downloadVideoDub: async () => {
          throw new Error('should not download');
        },
        postVideoPacked: async (_g, id, body) => {
          reported.push(`#${id} ${body.dubVersion}`);
        },
      },
      radVideoExe: 'radvideo64.exe',
      ffprobePath: 'ffprobe',
      packDir: path.join(root, 'pack'),
      downloadsDir: path.join(root, 'downloads'),
      state: { packedVideos: { 'Intro_ru.bk2': 'v1' }, videopackSeq: 1 },
    });
    expect(outcome).toEqual({ written: 0, skipped: 1, zipFile: null });
    expect(reported).toEqual(['#1 v1']);
    expect(fs.existsSync(path.join(root, 'downloads'))).toBe(false);
  });
});

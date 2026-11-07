import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { VideoPackTask } from '../../types';
import { packVideos, videopackFileName, type VideoPackState } from '../videoPack';

const media = { videoDir: 'Data/Video', videoExtensions: ['.bk2'], packDir: 'Video' };

const task = (
  videoId: number,
  fileName: string,
  fingerprint: string,
  dubVersion: string,
  byteSize: number | null = null,
): VideoPackTask => ({ videoId, modId: 5, fileName, fingerprint, dubVersion, byteSize });

describe('videopack', () => {
  let root: string;
  let videos: Record<string, string>;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'videopack-'));
    fs.mkdirSync(path.join(root, 'game', 'Data', 'Video'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'game', 'Data', 'Video', 'Intro_ru.bk2.vortex_backup'),
      'orig',
    );
    fs.writeFileSync(path.join(root, 'game', 'Data', 'Video', 'STRENGTH.bk2'), 'strength');
    // The inventory's view: the intro by its backup (our own dub is deployed over it).
    videos = {
      intro: path.join(root, 'game', 'Data', 'Video', 'Intro_ru.bk2.vortex_backup'),
      strength: path.join(root, 'game', 'Data', 'Video', 'STRENGTH.bk2'),
    };
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes each pending dub into every track of its video, reports it, and ships one archive', async () => {
    const calls: string[] = [];
    const state: VideoPackState = { packedVideos: { strength: 'v-old' }, videopackSeq: 2 };
    const outcome = await packVideos({
      game: 'fo4',
      tgtLang: 'uk',
      media,
      tasks: [
        task(1, 'Intro_ru.bk2', 'intro', 'v1', 3),
        task(2, 'STRENGTH.bk2', 'strength', 'v-old'),
        task(3, 'Gone.bk2', 'gone', 'v3'),
      ],
      locate: (fp) => videos[fp] ?? null,
      api: {
        downloadVideoDub: async (modId, id, dest) => {
          calls.push(`download mod ${modId} #${id}`);
          fs.writeFileSync(dest, 'wav');
          return 3;
        },
        postVideoPacked: async (modId, id, body) => {
          calls.push(`packed mod ${modId} #${id} ${body.dubVersion}`);
        },
      },
      radVideoExe: 'radvideo64.exe',
      ffprobePath: 'ffprobe',
      packDir: path.join(root, 'pack'),
      downloadsDir: path.join(root, 'downloads'),
      state,
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
      'download mod 5 #1',
      'mix Intro_ru.bk2.vortex_backup tracks 0,1',
      'packed mod 5 #1 v1',
      // Written in an earlier tick: the server is told again, nothing is mixed.
      'packed mod 5 #2 v-old',
      'zip pack -> Transynth_fo4_uk_videopack_r3.zip.part',
    ]);
    expect(fs.readdirSync(path.join(root, 'downloads'))).toEqual([
      'Transynth_fo4_uk_videopack_r3.zip',
    ]);
    // The output keeps the game's file name, whatever the input was called.
    expect(fs.readFileSync(path.join(root, 'pack', 'Video', 'Intro_ru.bk2'), 'utf8')).toBe(
      'dubbed',
    );
    expect(state).toEqual({
      packedVideos: { strength: 'v-old', intro: 'v1' },
      videopackSeq: 3,
    });
    expect(videopackFileName('fo4', 'uk', 7)).toBe('Transynth_fo4_uk_videopack_r7.zip');
  });

  it('ships nothing when every dub is already in place, and still reports it', async () => {
    const reported: string[] = [];
    const outcome = await packVideos({
      game: 'fo4',
      tgtLang: 'uk',
      media,
      tasks: [task(1, 'Intro_ru.bk2', 'intro', 'v1')],
      locate: (fp) => videos[fp] ?? null,
      api: {
        downloadVideoDub: async () => {
          throw new Error('should not download');
        },
        postVideoPacked: async (_m, id, body) => {
          reported.push(`#${id} ${body.dubVersion}`);
        },
      },
      radVideoExe: 'radvideo64.exe',
      ffprobePath: 'ffprobe',
      packDir: path.join(root, 'pack'),
      downloadsDir: path.join(root, 'downloads'),
      state: { packedVideos: { intro: 'v1' }, videopackSeq: 1 },
    });
    expect(outcome).toEqual({ written: 0, skipped: 1, zipFile: null });
    expect(reported).toEqual(['#1 v1']);
    expect(fs.existsSync(path.join(root, 'downloads'))).toBe(false);
  });
});

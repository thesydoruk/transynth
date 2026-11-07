import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isVideopackFolder,
  listVideoFiles,
  ownDeployedVideoNames,
  parseFfprobeJson,
  pickSourceTrack,
  resolveVideoSource,
  scanVideos,
  videoFingerprint,
} from '../videoScan';

const media = { videoDir: 'Data/Video', videoExtensions: ['.bk2'], packDir: 'Video' };

/** What ffprobe prints for a S.P.E.C.I.A.L. film: one Bink 2 video, five language tracks. */
const specialProbe = JSON.stringify({
  streams: [
    { index: 0, id: '0x0', codec_type: 'video' },
    { index: 1, id: '0x1', codec_type: 'audio' },
    { index: 2, id: '0x2', codec_type: 'audio' },
    { index: 3, id: '0x3', codec_type: 'audio' },
    { index: 4, id: '0x4', codec_type: 'audio' },
    { index: 5, id: '0x5', codec_type: 'audio' },
  ],
  format: { duration: '137.875000' },
});

describe('video scan', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-scan-'));
    fs.mkdirSync(path.join(root, 'Data', 'Video'), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reads the Bink track ids and the duration from ffprobe JSON', () => {
    expect(parseFfprobeJson(specialProbe)).toEqual({
      durationS: 137.875,
      tracks: [
        { id: 1, streamIndex: 1 },
        { id: 2, streamIndex: 2 },
        { id: 3, streamIndex: 3 },
        { id: 4, streamIndex: 4 },
        { id: 5, streamIndex: 5 },
      ],
    });
    expect(parseFfprobeJson('{"streams":[{"index":0,"id":"0x0","codec_type":"video"}]}')).toEqual({
      durationS: null,
      tracks: [],
    });
  });

  it('uploads the lowest track unless the config names one the video has', () => {
    const tracks = parseFfprobeJson(specialProbe).tracks;
    expect(pickSourceTrack(tracks, undefined)?.id).toBe(1);
    expect(pickSourceTrack(tracks, 3)?.id).toBe(3);
    expect(pickSourceTrack(tracks, 9)?.id).toBe(1);
    expect(pickSourceTrack([], 1)).toBeNull();
  });

  it('lists only the media extensions, and fingerprints by size, mtime and the head', () => {
    const dir = path.join(root, 'Data', 'Video');
    fs.writeFileSync(path.join(dir, 'STRENGTH.bk2'), 'strength');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'no');
    fs.writeFileSync(path.join(dir, 'Intro_ru.BK2'), 'intro');
    expect(listVideoFiles(root, media).map((p) => path.basename(p))).toEqual([
      'Intro_ru.BK2',
      'STRENGTH.bk2',
    ]);
    expect(listVideoFiles(path.join(root, 'missing'), media)).toEqual([]);

    const file = path.join(dir, 'STRENGTH.bk2');
    const first = videoFingerprint(file);
    expect(first.byteSize).toBe(8);
    expect(videoFingerprint(file).fingerprint).toBe(first.fingerprint);
    fs.writeFileSync(file, 'STRENGTH');
    expect(videoFingerprint(file).fingerprint).not.toBe(first.fingerprint);
  });

  it('reads a video Vortex deployed from our own videopack from the backup of the game file', async () => {
    const dir = path.join(root, 'Data', 'Video');
    fs.writeFileSync(path.join(dir, 'Intro_ru.bk2'), 'our previous dub');
    fs.writeFileSync(path.join(dir, 'Intro_ru.bk2.vortex_backup'), 'the game file');
    fs.writeFileSync(path.join(dir, 'STRENGTH.bk2'), 'another mod');
    fs.writeFileSync(path.join(dir, 'STRENGTH.bk2.vortex_backup'), 'the game file too');
    const staging = path.join(root, 'staging');
    fs.mkdirSync(staging);
    fs.writeFileSync(
      path.join(staging, 'vortex.deployment.json'),
      JSON.stringify({
        files: [
          { relPath: 'Video\\Intro_ru.bk2', source: 'Transynth_fo4_uk_videopack_r1' },
          { relPath: 'Video\\STRENGTH.bk2', source: 'Some Video Mod' },
          { relPath: 'Strings\\Fallout4_uk.STRINGS', source: 'Transynth_fo4_uk_videopack_r1' },
        ],
      }),
    );
    expect(isVideopackFolder('Transynth_fo4_uk_videopack_r12', 'fo4')).toBe(true);
    expect(isVideopackFolder('Transynth_fo4_uk_langpack_r12', 'fo4')).toBe(false);
    expect(isVideopackFolder('Transynth_skyrim_uk_videopack_r1', 'fo4')).toBe(false);
    const own = ownDeployedVideoNames(staging, 'fo4', media);
    expect([...own]).toEqual(['intro_ru.bk2']);
    expect(ownDeployedVideoNames(path.join(root, 'nowhere'), 'fo4', media).size).toBe(0);

    // The videopack's file is read from the backup; another mod's deployed video is the video.
    expect(resolveVideoSource(path.join(dir, 'Intro_ru.bk2'), own)).toBe(
      path.join(dir, 'Intro_ru.bk2.vortex_backup'),
    );
    expect(resolveVideoSource(path.join(dir, 'STRENGTH.bk2'), own)).toBe(
      path.join(dir, 'STRENGTH.bk2'),
    );
    const entries = await scanVideos({
      gameDir: root,
      media,
      ffprobePath: 'ffprobe',
      ownNames: own,
      probe: async () => parseFfprobeJson(specialProbe),
    });
    expect(entries.map((e) => [e.fileName, path.basename(e.absPath), e.byteSize])).toEqual([
      ['Intro_ru.bk2', 'Intro_ru.bk2.vortex_backup', 'the game file'.length],
      ['STRENGTH.bk2', 'STRENGTH.bk2', 'another mod'.length],
    ]);
    // Without the backup (no Vortex, or a deployment by copy) the file itself is read.
    fs.rmSync(path.join(dir, 'Intro_ru.bk2.vortex_backup'));
    expect(resolveVideoSource(path.join(dir, 'Intro_ru.bk2'), own)).toBe(
      path.join(dir, 'Intro_ru.bk2'),
    );
  });

  it('skips videos without an audio track', async () => {
    const dir = path.join(root, 'Data', 'Video');
    fs.writeFileSync(path.join(dir, 'MainMenuLoop.bk2'), 'loop');
    fs.writeFileSync(path.join(dir, 'STRENGTH.bk2'), 'strength');
    const entries = await scanVideos({
      gameDir: root,
      media,
      ffprobePath: 'ffprobe',
      probe: async (_bin, file) =>
        parseFfprobeJson(
          file.endsWith('MainMenuLoop.bk2')
            ? '{"streams":[{"index":0,"id":"0x0","codec_type":"video"}]}'
            : specialProbe,
        ),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      fileName: 'STRENGTH.bk2',
      byteSize: 8,
      durationS: 137.875,
      trackIds: [1, 2, 3, 4, 5],
      sourceTrackId: 1,
      sourceStreamIndex: 1,
    });
  });
});

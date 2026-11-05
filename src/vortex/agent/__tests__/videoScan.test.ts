import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  listVideoFiles,
  parseFfprobeJson,
  pickSourceTrack,
  scanVideos,
  videoFingerprint,
} from '../videoScan';

const media = { videoDir: 'Data/Video', videoExtensions: ['.bk2'] };

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

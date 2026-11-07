import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFfprobeJson, pickSourceTrack, videoDescriber } from '../videoProbe';

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

describe('video probe', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'video-probe-'));
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

  it('describes a video as the manifest the upload carries in its place', async () => {
    const file = path.join(root, 'STRENGTH.bk2');
    fs.writeFileSync(file, 'strength');
    const describe = videoDescriber({
      ffprobePath: 'ffprobe',
      hashFile: async () => 'c'.repeat(40),
      preferredTrackId: 3,
      agentKey: 'pc',
      probe: async () => parseFfprobeJson(specialProbe),
    });
    expect(await describe(file, 'STRENGTH.bk2')).toEqual({
      fileName: 'STRENGTH.bk2',
      byteSize: 8,
      sha1: 'c'.repeat(40),
      durationS: 137.875,
      trackIds: [1, 2, 3, 4, 5],
      sourceTrackId: 3,
      agentKey: 'pc',
    });
  });
});

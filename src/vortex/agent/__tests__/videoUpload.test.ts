import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { VideoUploadTask } from '../../types';
import { uploadVideoTracks } from '../videoUpload';

const task = (videoId: number, fileName: string, fingerprint: string): VideoUploadTask => ({
  videoId,
  modId: 5,
  fileName,
  fingerprint,
  sourceTrackId: fileName.startsWith('Intro') ? 0 : 1,
});

describe('video audio upload', () => {
  let workDir: string;
  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-upload-'));
  });
  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('decodes the chosen track of every video it can find and uploads it to its mod', async () => {
    const calls: string[] = [];
    const extracted: string[] = [];
    const outcome = await uploadVideoTracks({
      tasks: [
        task(10, 'Intro_ru.bk2', 'aaa'),
        task(11, 'LUCK.bk2', 'bbb'),
        task(12, 'Gone.bk2', 'ccc'),
      ],
      locate: (fp) => (fp === 'ccc' ? null : path.join('game', 'Data', 'Video', fp)),
      api: {
        putVideoAudio: async (modId, id, wav) => {
          calls.push(`upload mod ${modId} #${id} ${path.basename(wav)} ${fs.existsSync(wav)}`);
        },
      },
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      workDir,
      probe: async () => ({
        durationS: 10,
        tracks: [
          { id: 0, streamIndex: 1 },
          { id: 1, streamIndex: 2 },
        ],
      }),
      extract: async (_bin, abs, streamIndex, outWav) => {
        extracted.push(`${path.basename(abs)}:${streamIndex}`);
        fs.writeFileSync(outWav, 'wav');
      },
    });
    expect(outcome).toEqual({ uploaded: 2, skipped: 1 });
    // The intro asks for track 0 (stream 1), LUCK for track 1 (stream 2).
    expect(extracted).toEqual(['aaa:1', 'bbb:2']);
    expect(calls).toEqual(['upload mod 5 #10 10.wav true', 'upload mod 5 #11 11.wav true']);
    // The decoded WAVs are gone once uploaded.
    expect(fs.readdirSync(workDir)).toEqual([]);
  });

  it('removes the WAV even when the upload fails', async () => {
    await expect(
      uploadVideoTracks({
        tasks: [task(10, 'Intro_ru.bk2', 'aaa')],
        locate: () => 'Intro_ru.bk2',
        api: {
          putVideoAudio: async () => {
            throw new Error('fetch failed');
          },
        },
        ffmpegPath: 'ffmpeg',
        ffprobePath: 'ffprobe',
        workDir,
        probe: async () => ({ durationS: 10, tracks: [{ id: 0, streamIndex: 1 }] }),
        extract: async (_b, _a, _s, outWav) => fs.writeFileSync(outWav, 'wav'),
      }),
    ).rejects.toThrow('fetch failed');
    expect(fs.readdirSync(workDir)).toEqual([]);
  });
});

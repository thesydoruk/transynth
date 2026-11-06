import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { VideoScanEntry } from '../videoScan';
import { syncVideos, type VideoAssetView } from '../videoSync';

const entry = (fileName: string, fingerprint: string): VideoScanEntry => ({
  fileName,
  absPath: path.join('games', 'Data', 'Video', fileName),
  byteSize: 100,
  fingerprint,
  durationS: 10,
  trackIds: [0, 1],
  sourceTrackId: 0,
  sourceStreamIndex: 1,
});

const makeApi = (assets: VideoAssetView[]) => {
  const calls: string[] = [];
  let nextId = 10;
  const api = {
    listVideos: async () => {
      calls.push('list');
      return { assets };
    },
    registerVideo: async (_game: string, body: Record<string, unknown>) => {
      calls.push(`register ${String(body.fileName)}`);
      return { asset: { id: nextId++ } };
    },
    putVideoAudio: async (_game: string, id: number, wavPath: string) => {
      calls.push(
        `upload #${id} ${path.basename(wavPath)} ${fs.existsSync(wavPath) ? 'present' : 'missing'}`,
      );
    },
  };
  return { api, calls };
};

describe('video sync', () => {
  let workDir: string;
  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-sync-'));
  });
  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('uploads new and swapped videos, skips the ones the server already holds', async () => {
    const { api, calls } = makeApi([
      { id: 1, file_name: 'Intro_ru.bk2', fingerprint: 'same', audio_rel_path: 'fo4/1/source.wav' },
      { id: 2, file_name: 'STRENGTH.bk2', fingerprint: 'old', audio_rel_path: 'fo4/2/source.wav' },
      { id: 3, file_name: 'LUCK.bk2', fingerprint: 'same', audio_rel_path: null },
    ]);
    const extracted: string[] = [];
    const outcome = await syncVideos({
      game: 'fo4',
      agentKey: 'pc',
      entries: [
        entry('Intro_ru.bk2', 'same'),
        entry('STRENGTH.bk2', 'new'),
        entry('LUCK.bk2', 'same'),
        entry('CHARISMA.bk2', 'fresh'),
      ],
      api,
      ffmpegPath: 'ffmpeg',
      workDir,
      extract: async (_bin, abs, streamIndex, outWav) => {
        extracted.push(`${path.basename(abs)}:${streamIndex}`);
        fs.writeFileSync(outWav, 'wav');
      },
    });

    expect(outcome).toEqual({ registered: 3, uploaded: 3, skipped: 1 });
    expect(extracted).toEqual(['STRENGTH.bk2:1', 'LUCK.bk2:1', 'CHARISMA.bk2:1']);
    expect(calls).toEqual([
      'list',
      'register STRENGTH.bk2',
      'upload #10 STRENGTH.wav present',
      'register LUCK.bk2',
      'upload #11 LUCK.wav present',
      'register CHARISMA.bk2',
      'upload #12 CHARISMA.wav present',
    ]);
    // The decoded WAVs are gone once uploaded.
    expect(fs.readdirSync(workDir)).toEqual([]);
  });

  it('removes the WAV even when the upload fails', async () => {
    const { api } = makeApi([]);
    api.putVideoAudio = async () => {
      throw new Error('fetch failed');
    };
    await expect(
      syncVideos({
        game: 'fo4',
        agentKey: 'pc',
        entries: [entry('Intro_ru.bk2', 'x')],
        api,
        ffmpegPath: 'ffmpeg',
        workDir,
        extract: async (_b, _a, _s, outWav) => fs.writeFileSync(outWav, 'wav'),
      }),
    ).rejects.toThrow('fetch failed');
    expect(fs.readdirSync(workDir)).toEqual([]);
  });
});

import { describe, expect, it } from '@jest/globals';
import path from 'node:path';
import type { VideoUploadTask } from '../../types';
import { uploadVideoFiles } from '../videoUpload';

const task = (videoId: number, fileName: string, fingerprint: string): VideoUploadTask => ({
  videoId,
  modId: 5,
  fileName,
  fingerprint,
});

describe('video file upload', () => {
  it('uploads every video it can find by hash to its mod and skips the rest', async () => {
    const calls: string[] = [];
    const outcome = await uploadVideoFiles({
      tasks: [
        task(10, 'Intro_ru.bk2', 'aaa'),
        task(11, 'LUCK.bk2', 'bbb'),
        task(12, 'Gone.bk2', 'ccc'),
      ],
      locate: (fp) => (fp === 'ccc' ? null : path.join('game', 'Data', 'Video', fp)),
      api: {
        putVideoFile: async (modId, id, file) => {
          calls.push(`upload mod ${modId} #${id} ${path.basename(file)}`);
        },
      },
    });
    expect(outcome).toEqual({ uploaded: 2, skipped: 1 });
    expect(calls).toEqual(['upload mod 5 #10 aaa', 'upload mod 5 #11 bbb']);
  });

  it('stops at the first failed upload so the next heartbeat retries it', async () => {
    await expect(
      uploadVideoFiles({
        tasks: [task(10, 'Intro_ru.bk2', 'aaa')],
        locate: () => 'Intro_ru.bk2',
        api: {
          putVideoFile: async () => {
            throw new Error('fetch failed');
          },
        },
      }),
    ).rejects.toThrow('fetch failed');
  });
});

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deliverVideopack, shouldDeliverVideopack, videopackFileName } from '../videopackDelivery';

describe('videopack delivery', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'videopack-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('names the archive after the server version and delivers once per version', () => {
    expect(videopackFileName('fo4', 'uk', 'abcdef0123456789')).toBe(
      'Transynth_fo4_uk_videopack_abcdef01.zip',
    );
    expect(shouldDeliverVideopack(null, null)).toBe(false);
    expect(shouldDeliverVideopack(undefined, 'x')).toBe(false);
    expect(shouldDeliverVideopack({ version: 'v1', videos: 2 }, 'v1')).toBe(false);
    expect(shouldDeliverVideopack({ version: 'v2', videos: 2 }, 'v1')).toBe(true);
  });

  it('writes under a .part name, renames into place, and never downloads twice', async () => {
    const calls: string[] = [];
    const api = {
      downloadVideopack: async (_groupId: number, dest: string) => {
        calls.push(path.basename(dest));
        fs.writeFileSync(dest, 'zipzip');
        return 6;
      },
    };
    const opts = {
      groupId: 1,
      latest: { version: 'deadbeef1234', videos: 1 },
      downloadsDir: dir,
      game: 'fo4',
      tgtLang: 'uk',
    };
    const first = await deliverVideopack(api, opts);
    expect(first).toEqual({
      fileName: 'Transynth_fo4_uk_videopack_deadbeef.zip',
      bytes: 6,
      skipped: false,
    });
    expect(calls).toEqual(['Transynth_fo4_uk_videopack_deadbeef.zip.part']);
    expect(fs.readdirSync(dir)).toEqual(['Transynth_fo4_uk_videopack_deadbeef.zip']);

    const again = await deliverVideopack(api, opts);
    expect(again.skipped).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('leaves no .part behind when the download fails', async () => {
    const api = {
      downloadVideopack: async (_groupId: number, dest: string) => {
        fs.writeFileSync(dest, 'half');
        throw new Error('Download failed: 500');
      },
    };
    await expect(
      deliverVideopack(api, {
        groupId: 1,
        latest: { version: 'v1', videos: 1 },
        downloadsDir: dir,
        game: 'fo4',
        tgtLang: 'uk',
      }),
    ).rejects.toThrow('Download failed');
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

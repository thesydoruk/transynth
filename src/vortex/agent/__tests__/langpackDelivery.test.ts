import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  VORTEX_DOWNLOADS_MARKER,
  deliverLangpack,
  langpackFileName,
  looksLikeVortexDownloads,
  shouldDeliver,
} from '../langpackDelivery';

describe('langpack delivery', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'langpack-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('names archives by game, language and archive id, newest sorting last', () => {
    expect(langpackFileName('fo4', 'uk', 14)).toBe('Transynth_fo4_uk_langpack_r14.zip');
    expect(shouldDeliver(null, null)).toBe(false);
    const latest = { archiveId: 14, runId: 3, fileName: 'x.zip', byteSize: 5 };
    expect(shouldDeliver(latest, 14)).toBe(false);
    expect(shouldDeliver(latest, 13)).toBe(true);
  });

  it('recognises the Vortex downloads folder by its marker in the folder or its parent', () => {
    const game = path.join(dir, 'fallout4');
    fs.mkdirSync(game);
    expect(looksLikeVortexDownloads(game)).toBe(false);
    fs.writeFileSync(path.join(dir, VORTEX_DOWNLOADS_MARKER), '');
    expect(looksLikeVortexDownloads(game)).toBe(true);
  });

  it('writes under a .part name, renames into place, and never downloads twice', async () => {
    const calls: string[] = [];
    const api = {
      downloadLangpack: async (_runId: number, dest: string) => {
        calls.push(path.basename(dest));
        fs.writeFileSync(dest, 'zipzip');
        return 6;
      },
    };
    const latest = { archiveId: 7, runId: 2, fileName: 'fo4_uk_langpack.zip', byteSize: 6 };

    const first = await deliverLangpack(api, {
      latest,
      downloadsDir: dir,
      game: 'fo4',
      tgtLang: 'uk',
    });
    expect(first).toEqual({
      fileName: 'Transynth_fo4_uk_langpack_r7.zip',
      bytes: 6,
      skipped: false,
    });
    expect(calls).toEqual(['Transynth_fo4_uk_langpack_r7.zip.part']);
    expect(fs.readdirSync(dir)).toEqual(['Transynth_fo4_uk_langpack_r7.zip']);

    const again = await deliverLangpack(api, {
      latest,
      downloadsDir: dir,
      game: 'fo4',
      tgtLang: 'uk',
    });
    expect(again.skipped).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('drops a short download instead of handing Vortex a broken archive', async () => {
    const api = {
      downloadLangpack: async (_runId: number, dest: string) => {
        fs.writeFileSync(dest, 'zip');
        return 3;
      },
    };
    const latest = { archiveId: 8, runId: 2, fileName: 'x.zip', byteSize: 6 };
    await expect(
      deliverLangpack(api, { latest, downloadsDir: dir, game: 'fo4', tgtLang: 'uk' }),
    ).rejects.toThrow(/3 bytes/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

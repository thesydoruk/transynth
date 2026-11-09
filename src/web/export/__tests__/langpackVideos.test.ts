import { afterAll, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'langpack-videos-'));
process.env.VIDEO_UPLOAD_DIR = uploads;
// The setup file has loaded `paths` already; reload it so the upload dir above applies.
jest.resetModules();

await import('../../../games');
const { LOCALIZED_EXPORT_GOLDEN_CORPUS } = await import('../../../testdata/exportGoldenCorpus');
const { resolveVideoAudioPath, videoPackedRelPath } = await import('../../../video/audioStore');
const { exportLangpackZipToPath } = await import('../batchLangpack');
type Tx = import('../../../db').Tx;

afterAll(() => fs.rmSync(uploads, { recursive: true, force: true }));

const asset = (id: number, fileName: string, dub: string | null, packed: string | null) => ({
  id,
  mod_id: 1,
  file_name: fileName,
  byte_size: 4,
  fingerprint: 'a'.repeat(40),
  track_ids: [0],
  dub_rel_path: dub ? `assets/${id}/dub_uk.wav` : null,
  dub_version: dub,
  packed_version: packed,
});

/** Video rows for the video query, nothing for the game's own collection. */
const videoDb = (rows: ReturnType<typeof asset>[]): Tx =>
  ({
    query: async (sql: string) => ({ rows: /FROM video_assets/.test(sql) ? rows : [] }),
  }) as unknown as Tx;

const writePacked = (row: ReturnType<typeof asset>, body: string): void => {
  const file = resolveVideoAudioPath(videoPackedRelPath(row));
  if (!file.startsWith(uploads)) throw new Error(`refusing to write outside the test dir: ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};

describe('langpack videos', () => {
  it('ships a dubbed video under Video/ and leaves out a dub not yet written into one', async () => {
    const current = asset(1, 'Intro_ru.bk2', 'v2', 'v2');
    const stale = asset(2, 'LUCK.bk2', 'v3', 'v2');
    const unpacked = asset(3, 'Mod.bk2', 'v1', null);
    writePacked(current, 'BIK2 dubbed');
    writePacked(stale, 'BIK2 old dub');

    const modDir = fs.mkdtempSync(path.join(os.tmpdir(), 'langpack-videos-mod-'));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'langpack-videos-out-'));
    try {
      const modPath = path.join(modDir, 'Fallout4.esm');
      fs.writeFileSync(modPath, Buffer.from('TES4', 'ascii'));
      const dest = path.join(outDir, 'fo4_uk_langpack.zip');

      const result = await exportLangpackZipToPath(
        videoDb([current, stale, unpacked]),
        [{ modId: 1, modPath, game: 'fo4' }],
        LOCALIZED_EXPORT_GOLDEN_CORPUS.sourceLang,
        LOCALIZED_EXPORT_GOLDEN_CORPUS.targetLang,
        dest,
      );

      expect(result.fileCount).toBe(1);
      const zip = fs.readFileSync(dest).toString('latin1');
      expect(zip).toContain('Video/Intro_ru.bk2');
      expect(zip).toContain('BIK2 dubbed');
      expect(zip).not.toContain('LUCK.bk2');
      expect(zip).not.toContain('Mod.bk2');
      // The staging tree is linked, not the source: the dubbed copy outlives the export.
      expect(fs.readFileSync(resolveVideoAudioPath(videoPackedRelPath(current)), 'utf8')).toBe(
        'BIK2 dubbed',
      );
    } finally {
      fs.rmSync(modDir, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }, 30_000);
});

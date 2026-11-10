import { afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../../games';
import { ensureModImportSchema } from '../../import/mod/schema';
import { npcPlugin } from '../../testing/espFixture';
import { useTestDb } from '../../testing/testDb';
import { packFilesToZipPath } from '../../web/export/zipPack';
import { getOrCreateVortexGroup } from '../db';
import { registerVortexPack, vortexExtractDir } from '../registerPack';
import { scopedVortexFileHash } from '../groupKey';
import { ensureVortexSchema } from '../schema';

describe('registerVortexPack', () => {
  const db = useTestDb();
  let tmp: string;
  let groupId: number;

  beforeAll(async () => {
    await ensureVortexSchema(db());
    await ensureModImportSchema(db());
  });

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-pack-'));
    const group = await getOrCreateVortexGroup(db(), {
      game: 'fo4',
      groupKey: 'fo4:c:/vortex/fallout4/mods',
      label: 'Vortex · fallout4',
      stagingPath: 'C:/Vortex/fallout4/mods',
      gameDir: 'C:/Games/Fallout 4',
    });
    groupId = group.id;
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const pack = async (contentHash: string, plugins: Record<string, string[]>) => {
    const zipPath = path.join(tmp, `${contentHash}.zip`);
    await packFilesToZipPath(
      Object.entries(plugins).map(([name, npcs]) => ({ name, data: npcPlugin(npcs) })),
      zipPath,
    );
    return registerVortexPack(db(), {
      groupId,
      fileName: 'SS2.zip',
      zipPath,
      extractDir: vortexExtractDir(tmp, scopedVortexFileHash(groupId, contentHash)),
      contentHash,
      srcLang: 'en',
      tgtLang: 'uk',
      game: 'fo4',
      sourceFolder:
        'Sim Settlements 2 - All Chapters Pack 73394 3.8.1a 2026-10-27T05-48Z 86DAb3Tia',
      plugins: Object.keys(plugins),
      pluginFileName: 'SS2.esm',
    });
  };

  it('registers one job per plugin of a folder, extras only for the main one', async () => {
    const result = await pack('aa11', {
      'SS2.esm': ['Jake', 'Sheffield'],
      'SS2_XPAC_Chapter2.esm': ['Benny'],
    });

    expect(result.jobs.map((row) => row.plugin)).toEqual(['SS2.esm', 'SS2_XPAC_Chapter2.esm']);
    expect(result.primary.esp_path && path.basename(result.primary.esp_path)).toBe('SS2.esm');
    expect(
      result.jobs.map((row) => [row.job.file_hash, row.job.import_extras, row.job.total_records]),
    ).toEqual([
      [`v${groupId}:aa11:ss2`, true, 2],
      [`v${groupId}:aa11:ss2_xpac_chapter2`, false, 1],
    ]);
    // Both read the one tree the zip was unpacked into.
    expect(new Set(result.jobs.map((row) => path.dirname(row.job.esp_path!))).size).toBe(1);
  });

  it('returns the jobs it already has when the same folder is uploaded again', async () => {
    const first = await pack('bb22', { 'A.esm': ['One'], 'B.esp': ['Two'] });
    const again = await pack('bb22', { 'A.esm': ['One'], 'B.esp': ['Two'] });
    expect(again.jobs.map((row) => row.job.id)).toEqual(first.jobs.map((row) => row.job.id));
  });

  it('keeps a one-plugin folder on the single scoped hash it always had', async () => {
    const result = await pack('cc33', { 'Solo.esp': ['Only'] });
    expect(result.jobs).toHaveLength(1);
    expect(result.primary.file_hash).toBe(`v${groupId}:cc33`);
    expect(result.primary.import_extras).toBe(true);
  });
});

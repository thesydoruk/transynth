import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import type { Tx } from '../../../db';
import { writeStringsBuffer } from '../../../formats/strings';
import {
  LOCALIZED_EXPORT_GOLDEN_CORPUS,
  goldenFixtureToMap,
} from '../../../testdata/exportGoldenCorpus';
import {
  exportLangpackZipBatch,
  exportLangpackZipToPath,
  mergeLangpackEntries,
  normalizeLangpackZipPath,
} from '../batchLangpack';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

const makeOverlayDb = (
  rows: Array<{ lstring_id: number; signature: string; path: string; export_text: string }>,
): Tx => {
  return {
    query: async () => ({ rows }),
  } as unknown as Tx;
};

const createLooseStringsMod = (pluginFileName: string): string => {
  const stem = path.basename(pluginFileName, path.extname(pluginFileName));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-langpack-'));
  tempDirs.push(root);
  const pluginPath = path.join(root, pluginFileName);
  const stringsDir = path.join(root, 'Strings');
  fs.mkdirSync(stringsDir, { recursive: true });
  fs.writeFileSync(pluginPath, Buffer.from('TES4', 'ascii'));

  for (const file of LOCALIZED_EXPORT_GOLDEN_CORPUS.sourceFiles) {
    const fileName = file.fileName.replace(
      LOCALIZED_EXPORT_GOLDEN_CORPUS.pluginFileName.replace(/\.esp$/i, ''),
      stem,
    );
    fs.writeFileSync(
      path.join(stringsDir, fileName),
      writeStringsBuffer(goldenFixtureToMap(file), file.type),
    );
  }

  return pluginPath;
};

describe('normalizeLangpackZipPath', () => {
  it('strips a leading Data folder so Vortex sees one game-data tree', () => {
    expect(normalizeLangpackZipPath('Data\\Strings\\Mod_uk.STRINGS')).toBe(
      'Strings/Mod_uk.STRINGS',
    );
    expect(normalizeLangpackZipPath('./data/Interface/Translate_ukrainian.txt')).toBe(
      'Interface/Translate_ukrainian.txt',
    );
  });
});

describe('mergeLangpackEntries', () => {
  it('flattens Data-prefixed and root paths onto the same key', () => {
    const older = Buffer.from('older');
    const newer = Buffer.from('newer');
    const merged = mergeLangpackEntries([
      { name: 'Data/Strings/Shared.STRINGS', data: older },
      { name: 'Strings/Shared.STRINGS', data: newer },
      { name: 'Strings/Other.STRINGS', data: Buffer.from('other') },
    ]);

    expect(merged.map((file) => file.name).sort()).toEqual([
      'Strings/Other.STRINGS',
      'Strings/Shared.STRINGS',
    ]);
    expect(merged.find((file) => file.name === 'Strings/Shared.STRINGS')?.data).toEqual(newer);
  });
});

describe('exportLangpackZipBatch', () => {
  it('packs several mods into one archive without a folder per mod', async () => {
    const firstPath = createLooseStringsMod('PluginOne.esp');
    const secondPath = createLooseStringsMod('PluginTwo.esp');
    const db = makeOverlayDb(LOCALIZED_EXPORT_GOLDEN_CORPUS.translationOverlayRows);

    const { zipBuffer, zipFileName } = await exportLangpackZipBatch(
      db,
      [
        { modId: 1, modPath: firstPath, game: 'fo4' },
        { modId: 2, modPath: secondPath, game: 'fo4' },
      ],
      LOCALIZED_EXPORT_GOLDEN_CORPUS.sourceLang,
      LOCALIZED_EXPORT_GOLDEN_CORPUS.targetLang,
    );

    expect(zipFileName).toBe('fo4_uk_langpack.zip');
    const zipText = zipBuffer.toString('latin1');
    expect(zipText).toContain('Strings/PluginOne_en.STRINGS');
    expect(zipText).toContain('Strings/PluginTwo_en.STRINGS');
    expect(zipText).not.toContain('PluginOne/Strings/');
    expect(zipText).not.toContain('PluginTwo/Strings/');
    expect(zipText).not.toContain('mod-1/');
    expect(zipText).not.toContain('mod-2/');
  }, 30_000);

  it('writes the archive to disk without a per-mod folder', async () => {
    const firstPath = createLooseStringsMod('PluginOne.esp');
    const secondPath = createLooseStringsMod('PluginTwo.esp');
    const db = makeOverlayDb(LOCALIZED_EXPORT_GOLDEN_CORPUS.translationOverlayRows);
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'langpack-path-'));
    tempDirs.push(outDir);
    const destPath = path.join(outDir, 'fo4_uk_langpack.zip');

    const result = await exportLangpackZipToPath(
      db,
      [
        { modId: 1, modPath: firstPath, game: 'fo4' },
        { modId: 2, modPath: secondPath, game: 'fo4' },
      ],
      LOCALIZED_EXPORT_GOLDEN_CORPUS.sourceLang,
      LOCALIZED_EXPORT_GOLDEN_CORPUS.targetLang,
      destPath,
    );

    expect(result.byteSize).toBeGreaterThan(0);
    expect(fs.existsSync(destPath)).toBe(true);
    const zipText = fs.readFileSync(destPath).toString('latin1');
    expect(zipText).toContain('Strings/PluginOne_en.STRINGS');
    expect(zipText).toContain('Strings/PluginTwo_en.STRINGS');
    expect(fs.existsSync(`${destPath}.staging`)).toBe(false);
  }, 30_000);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import type { Tx } from '../../db';
import { Ba2Reader } from '../../bethesda/ba2';
import { parseStringsBuffer, writeStringsBuffer } from '../../bethesda/strings';
import {
  LOCALIZED_EXPORT_GOLDEN_CORPUS,
  goldenFixtureToMap,
} from '../../testdata/exportGoldenCorpus';
import { exportBa2Archive, exportLocalizedStringsFiles } from '../exportService';

const makeOverlayDb = (rows: Array<{ lstring_id: number; export_text: string }>): Tx => {
  return {
    query: async () => ({ rows }),
  } as unknown as Tx;
};

const createLooseStringsMod = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-export-'));
  const pluginPath = path.join(root, LOCALIZED_EXPORT_GOLDEN_CORPUS.pluginFileName);
  const stringsDir = path.join(root, 'Strings');
  fs.mkdirSync(stringsDir, { recursive: true });
  fs.writeFileSync(pluginPath, Buffer.from('TES4', 'ascii'));

  for (const file of LOCALIZED_EXPORT_GOLDEN_CORPUS.sourceFiles) {
    fs.writeFileSync(
      path.join(stringsDir, file.fileName),
      writeStringsBuffer(goldenFixtureToMap(file), file.type),
    );
  }

  tempDirs.push(root);
  return pluginPath;
};

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('localized export golden corpus', () => {
  it('preserves source file inventory, basename casing, and fallback text', async () => {
    const modPath = createLooseStringsMod();
    const db = makeOverlayDb(
      LOCALIZED_EXPORT_GOLDEN_CORPUS.translationOverlay.map(({ id, text }) => ({
        lstring_id: id,
        export_text: text,
      })),
    );

    const exported = await exportLocalizedStringsFiles(
      db,
      1,
      modPath,
      LOCALIZED_EXPORT_GOLDEN_CORPUS.sourceLang,
      LOCALIZED_EXPORT_GOLDEN_CORPUS.targetLang,
    );

    expect(exported.map((file) => file.fileName)).toEqual(
      LOCALIZED_EXPORT_GOLDEN_CORPUS.expectedFiles.map((file) => file.fileName),
    );

    for (const expected of LOCALIZED_EXPORT_GOLDEN_CORPUS.expectedFiles) {
      const actual = exported.find((file) => file.fileName === expected.fileName);
      expect(actual).toBeDefined();
      const parsed = parseStringsBuffer(Buffer.from(actual!.contentBase64, 'base64'), expected.type);
      expect([...parsed.entries()]).toEqual([...goldenFixtureToMap(expected).entries()]);
    }
  });

  it('packs the exported corpus into a BA2 with exactly the expected strings files', async () => {
    const modPath = createLooseStringsMod();
    const db = makeOverlayDb(
      LOCALIZED_EXPORT_GOLDEN_CORPUS.translationOverlay.map(({ id, text }) => ({
        lstring_id: id,
        export_text: text,
      })),
    );

    const ba2 = await exportBa2Archive(
      db,
      1,
      modPath,
      LOCALIZED_EXPORT_GOLDEN_CORPUS.sourceLang,
      LOCALIZED_EXPORT_GOLDEN_CORPUS.targetLang,
    );

    const archivePath = path.join(path.dirname(modPath), ba2.fileName);
    fs.writeFileSync(archivePath, Buffer.from(ba2.contentBase64, 'base64'));

    const reader = new Ba2Reader(archivePath);
    expect(reader.listFiles()).toEqual(
      LOCALIZED_EXPORT_GOLDEN_CORPUS.expectedFiles.map((file) => `Strings\\${file.fileName}`),
    );

    for (const expected of LOCALIZED_EXPORT_GOLDEN_CORPUS.expectedFiles) {
      const extracted = reader.extractByName(`Strings\\${expected.fileName}`);
      expect(extracted).not.toBeNull();
      const parsed = parseStringsBuffer(extracted!, expected.type);
      expect([...parsed.entries()]).toEqual([...goldenFixtureToMap(expected).entries()]);
    }
  });
});
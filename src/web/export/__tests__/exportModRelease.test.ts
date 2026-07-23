import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import type { Tx } from '../../../db';
import { Ba2Reader } from '../../../formats/ba2';
import { parsePexBuffer, writeWString } from '../../../formats/pex';
import { parseStringsBuffer, writeStringsBuffer } from '../../../formats/strings';
import {
  LOCALIZED_EXPORT_GOLDEN_CORPUS,
  goldenFixtureToMap,
} from '../../../testdata/exportGoldenCorpus';
import { exportModRelease } from '../index';

const buildPex = (strings: string[], sourceFile = 'DialogScript.psc'): Buffer => {
  const wsize = (s: string) => 2 + Buffer.byteLength(s, 'utf8');
  const totalSize =
    16 +
    wsize(sourceFile) +
    wsize('testuser') +
    wsize('testmachine') +
    2 +
    strings.reduce((acc, s) => acc + wsize(s), 0);
  const buf = Buffer.alloc(totalSize, 0);
  let pos = 0;

  buf.writeUInt32BE(0xfa57c0de, pos);
  pos += 4;
  buf.writeUInt8(3, pos);
  pos += 1;
  buf.writeUInt8(2, pos);
  pos += 1;
  buf.writeUInt16BE(3, pos);
  pos += 2;
  pos += 8;

  for (const part of [sourceFile, 'testuser', 'testmachine']) {
    const chunk = writeWString(part);
    chunk.copy(buf, pos);
    pos += chunk.length;
  }

  buf.writeUInt16BE(strings.length, pos);
  pos += 2;
  for (const value of strings) {
    const chunk = writeWString(value);
    chunk.copy(buf, pos);
    pos += chunk.length;
  }

  return buf;
};

const createLooseStringsMod = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-export-'));
  tempDirs.push(root);
  const pluginPath = path.join(root, LOCALIZED_EXPORT_GOLDEN_CORPUS.pluginFileName);
  const stringsDir = path.join(root, 'Strings');
  const scriptsDir = path.join(root, 'Scripts');
  fs.mkdirSync(stringsDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(pluginPath, Buffer.from('TES4', 'ascii'));
  fs.writeFileSync(path.join(scriptsDir, 'DialogScript.pex'), buildPex(['Hello world']));

  for (const file of LOCALIZED_EXPORT_GOLDEN_CORPUS.sourceFiles) {
    fs.writeFileSync(
      path.join(stringsDir, file.fileName),
      writeStringsBuffer(goldenFixtureToMap(file), file.type),
    );
  }

  return pluginPath;
};

const makeOverlayDb = (
  pexRows: Array<{ path: string; source_text: string; export_text: string }> = [],
): Tx => {
  return {
    query: async (sql: string) => {
      if (sql.includes('s.lstring_id IS NOT NULL')) {
        return {
          rows: LOCALIZED_EXPORT_GOLDEN_CORPUS.translationOverlay.map(({ id, text }) => ({
            lstring_id: id,
            export_text: text,
          })),
        };
      }
      if (sql.includes("r.signature = 'PEX'")) {
        return { rows: pexRows };
      }
      if (sql.includes('s.lstring_id IS NULL')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  } as unknown as Tx;
};

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('exportModRelease', () => {
  it('falls back to loose STRINGS and exports loose scripts without archives', async () => {
    const modPath = createLooseStringsMod();
    const outDir = path.join(path.dirname(modPath), 'out');
    const db = makeOverlayDb([
      {
        path: 'PEX\\DialogScript',
        source_text: 'Hello world',
        export_text: 'Привіт, світ',
      },
    ]);

    const result = await exportModRelease(
      db,
      1,
      modPath,
      LOCALIZED_EXPORT_GOLDEN_CORPUS.sourceLang,
      LOCALIZED_EXPORT_GOLDEN_CORPUS.targetLang,
      'fo4',
      outDir,
    );

    expect(result.files).toEqual(
      expect.arrayContaining([
        ...LOCALIZED_EXPORT_GOLDEN_CORPUS.expectedFiles.map((file) => `Strings/${file.fileName}`),
        'Scripts/DialogScript.pex',
      ]),
    );
    expect(result.files.some((file) => file.endsWith('.ba2'))).toBe(false);

    const patchedPex = fs.readFileSync(path.join(outDir, 'Scripts', 'DialogScript.pex'));
    expect(parsePexBuffer(patchedPex).strings).toContain('Привіт, світ');
  });

  it('skips scripts when localizeScripts is false', async () => {
    const modPath = createLooseStringsMod();
    const outDir = path.join(path.dirname(modPath), 'out');
    const db = makeOverlayDb();

    const result = await exportModRelease(
      db,
      1,
      modPath,
      LOCALIZED_EXPORT_GOLDEN_CORPUS.sourceLang,
      LOCALIZED_EXPORT_GOLDEN_CORPUS.targetLang,
      'fo4',
      outDir,
      { localizeScripts: false },
    );

    expect(result.files.every((file) => !file.includes('Scripts/'))).toBe(true);
    expect(result.files.some((file) => file.startsWith('Strings/'))).toBe(true);
  });

  it('exports only STRINGS when forceLocalized is enabled', async () => {
    const modPath = createLooseStringsMod();
    const outDir = path.join(path.dirname(modPath), 'out');
    const db = makeOverlayDb();

    const result = await exportModRelease(
      db,
      1,
      modPath,
      LOCALIZED_EXPORT_GOLDEN_CORPUS.sourceLang,
      LOCALIZED_EXPORT_GOLDEN_CORPUS.targetLang,
      'fo4',
      outDir,
      { forceLocalized: true, localizeScripts: false },
    );

    expect(result.files).toEqual(
      expect.arrayContaining(
        LOCALIZED_EXPORT_GOLDEN_CORPUS.expectedFiles.map((file) => `Strings/${file.fileName}`),
      ),
    );
    expect(fs.existsSync(path.join(outDir, LOCALIZED_EXPORT_GOLDEN_CORPUS.pluginFileName))).toBe(
      false,
    );
  });

  it('packs STRINGS into BA2 when repackArchives is enabled', async () => {
    const modPath = createLooseStringsMod();
    const outDir = path.join(path.dirname(modPath), 'out');
    const db = makeOverlayDb();

    const result = await exportModRelease(
      db,
      1,
      modPath,
      LOCALIZED_EXPORT_GOLDEN_CORPUS.sourceLang,
      LOCALIZED_EXPORT_GOLDEN_CORPUS.targetLang,
      'fo4',
      outDir,
      { forceLocalized: true, repackArchives: true, localizeScripts: false },
    );

    const archiveName = `${path.basename(modPath, path.extname(modPath))} - Main.ba2`;
    expect(result.files).toEqual([archiveName]);
    const archivePath = path.join(outDir, archiveName);
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

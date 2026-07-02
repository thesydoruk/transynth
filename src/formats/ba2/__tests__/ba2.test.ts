import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it, expect } from '@jest/globals';
import { parseStringsBuffer, writeStringsBuffer } from '../../strings';
import { Ba2Reader, writeBa2, isBa2GnrArchive, readBa2ArchiveType } from '..';
import type { ArchiveInputFile } from '../../types';
import {
  LOCALIZED_EXPORT_GOLDEN_CORPUS,
  goldenFixtureToMap,
} from '../../../testdata/exportGoldenCorpus';

const tempArtifacts: string[] = [];

afterEach(() => {
  while (tempArtifacts.length > 0) {
    const target = tempArtifacts.pop();
    if (target && fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  }
});

describe('readBa2ArchiveType', () => {
  it('detects GNRL archives written by writeBa2', () => {
    const ba2 = writeBa2([{ name: 'Strings\\Test_en.STRINGS', data: Buffer.from('x') }]);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'formats-ba2-type-'));
    const archivePath = path.join(tempDir, 'test.ba2');
    tempArtifacts.push(tempDir);
    fs.writeFileSync(archivePath, ba2);

    expect(readBa2ArchiveType(archivePath)).toBe('GNRL');
    expect(isBa2GnrArchive(archivePath)).toBe(true);
  });

  it('returns null for non-BA2 files', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'formats-ba2-type-'));
    const filePath = path.join(tempDir, 'not.ba2');
    tempArtifacts.push(tempDir);
    fs.writeFileSync(filePath, Buffer.from('not an archive'));

    expect(readBa2ArchiveType(filePath)).toBeNull();
    expect(isBa2GnrArchive(filePath)).toBe(false);
  });
});

describe('BA2 writer', () => {
  it('produces a valid BTDX GNRL archive', () => {
    const content = Buffer.from('Hello BA2!');
    const files: ArchiveInputFile[] = [{ name: 'Strings\\Test_uk.STRINGS', data: content }];
    const ba2 = writeBa2(files);

    expect(ba2.toString('ascii', 0, 4)).toBe('BTDX');
    expect(ba2.readUInt32LE(4)).toBe(1);
    expect(ba2.toString('ascii', 8, 12)).toBe('GNRL');
    expect(ba2.readUInt32LE(12)).toBe(1);

    const dataSlice = ba2.subarray(60, 60 + content.length);
    expect(dataSlice.toString()).toBe('Hello BA2!');

    const ntOffset = Number(ba2.readBigUInt64LE(16));
    const nameLen = ba2.readUInt16LE(ntOffset);
    const name = ba2.toString('utf8', ntOffset + 2, ntOffset + 2 + nameLen);
    expect(name).toBe('Strings\\Test_uk.STRINGS');
  });

  it('round-trips STRINGS through BA2 write -> manual extract', () => {
    const map = new Map<number, string>([
      [1, 'Vault Boy'],
      [2, 'Пустка'],
    ]);
    const strBuf = writeStringsBuffer(map, 'STRINGS');

    const ba2 = writeBa2([{ name: 'Strings\\mod_uk.STRINGS', data: strBuf }]);

    const unpackedSize = ba2.readUInt32LE(24 + 28);
    const offset = Number(ba2.readBigUInt64LE(24 + 16));
    const extracted = ba2.subarray(offset, offset + unpackedSize);

    const parsed = parseStringsBuffer(extracted, 'STRINGS');
    expect(parsed.get(1)).toBe('Vault Boy');
    expect(parsed.get(2)).toBe('Пустка');
  });

  it('preserves the golden corpus file inventory and per-file payloads', () => {
    const files: ArchiveInputFile[] = LOCALIZED_EXPORT_GOLDEN_CORPUS.sourceFiles.map((file) => ({
      name: `Strings\\${file.fileName}`,
      data: writeStringsBuffer(goldenFixtureToMap(file), file.type),
    }));

    const archive = writeBa2(files);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'formats-ba2-'));
    const archivePath = path.join(tempDir, 'golden.ba2');
    tempArtifacts.push(tempDir);
    fs.writeFileSync(archivePath, archive);

    const reader = new Ba2Reader(archivePath);
    expect(reader.listFiles()).toEqual(files.map((file) => file.name));

    for (const file of LOCALIZED_EXPORT_GOLDEN_CORPUS.sourceFiles) {
      const extracted = reader.extractByName(`Strings\\${file.fileName}`);
      expect(extracted).not.toBeNull();
      const parsed = parseStringsBuffer(extracted!, file.type);
      expect([...parsed.entries()]).toEqual([...goldenFixtureToMap(file).entries()]);
    }
  });
});

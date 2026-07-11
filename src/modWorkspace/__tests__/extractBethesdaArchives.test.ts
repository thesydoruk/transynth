import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { writeBa2 } from '../../formats/ba2';
import { writeStringsBuffer } from '../../formats/strings';
import { MOD_IMPORT_MANIFEST_FILE_NAME, readModImportExtractManifest } from '../archiveManifest';
import { extractAllBethesdaArchivesInTreeWithManifest } from '../extractBethesdaArchives';
import { extractGameArchivesForImport } from '../../web/import/modImportExtract';

const tempArtifacts: string[] = [];

afterEach(() => {
  while (tempArtifacts.length > 0) {
    const target = tempArtifacts.pop();
    if (target && fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  }
});

describe('extractAllBethesdaArchivesInTreeWithManifest', () => {
  it('extracts GNRL BA2 in place and records file provenance', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-manifest-'));
    tempArtifacts.push(root);

    const stringsBuf = writeStringsBuffer(new Map([[1, 'Hello']]), 'STRINGS');
    const ba2 = writeBa2([{ name: 'Strings\\MyMod_en.STRINGS', data: stringsBuf }]);
    fs.writeFileSync(path.join(root, 'MyMod - Main.ba2'), ba2);

    const { archives, files } = extractAllBethesdaArchivesInTreeWithManifest(root);

    expect(archives).toHaveLength(1);
    expect(archives[0]).toMatchObject({
      fileName: 'MyMod - Main.ba2',
      relativePath: 'MyMod - Main.ba2',
      packing: 'ba2',
      extracted: true,
      ba2Type: 'GNRL',
    });
    expect(archives[0]?.entries).toContain('Strings/MyMod_en.STRINGS');
    expect(fs.existsSync(path.join(root, 'MyMod - Main.ba2'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'Strings', 'MyMod_en.STRINGS'))).toBe(true);
    expect(files['Strings/MyMod_en.STRINGS']).toEqual({
      sourceArchiveRelativePath: 'MyMod - Main.ba2',
      entryPath: 'Strings/MyMod_en.STRINGS',
      packing: 'ba2',
    });
  });
});

describe('extractGameArchivesForImport', () => {
  it('writes import-manifest.json with container metadata', () => {
    const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-extract-'));
    tempArtifacts.push(uploadDir);

    const extractRoot = path.join(uploadDir, '_extracted_abc');
    fs.mkdirSync(extractRoot, { recursive: true });

    const stringsBuf = writeStringsBuffer(new Map([[1, 'Vault']]), 'STRINGS');
    const ba2 = writeBa2([{ name: 'Strings\\Demo_en.STRINGS', data: stringsBuf }]);
    fs.writeFileSync(path.join(extractRoot, 'Demo - Main.ba2'), ba2);
    fs.writeFileSync(path.join(uploadDir, 'Demo.zip'), Buffer.from('zip-placeholder'));

    const manifest = extractGameArchivesForImport({
      extractRoot,
      container: { fileName: 'Demo.zip', archivePath: path.join(uploadDir, 'Demo.zip') },
    });

    expect(manifest.container).toEqual({
      fileName: 'Demo.zip',
      packing: 'zip',
      relativePath: '../Demo.zip',
    });
    expect(manifest.archives).toHaveLength(1);
    expect(fs.existsSync(path.join(extractRoot, MOD_IMPORT_MANIFEST_FILE_NAME))).toBe(true);
    expect(readModImportExtractManifest(extractRoot)?.files['Strings/Demo_en.STRINGS']).toEqual({
      sourceArchiveRelativePath: 'Demo - Main.ba2',
      entryPath: 'Strings/Demo_en.STRINGS',
      packing: 'ba2',
    });
  });
});

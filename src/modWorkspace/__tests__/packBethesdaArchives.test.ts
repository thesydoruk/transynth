import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Ba2Reader } from '../../formats/ba2';
import { collectArchiveableLooseFiles, defaultArchiveFileName } from '../bethesdaArchivePaths';
import {
  inferArchivesForPackage,
  packBethesdaArchivesIntoDir,
  refreshArchiveEntryPaths,
} from '../packBethesdaArchives';

describe('packBethesdaArchives', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-ba-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('infers and packs FO4 BA2 from loose Strings files', () => {
    const packageDir = path.join(tmpDir, 'pkg');
    const stringsDir = path.join(packageDir, 'Strings');
    fs.mkdirSync(stringsDir, { recursive: true });
    fs.writeFileSync(path.join(stringsDir, 'MyMod_uk.STRINGS'), Buffer.from('test'));
    fs.writeFileSync(path.join(packageDir, 'MyMod.esp'), Buffer.from('esp'));

    const inferred = inferArchivesForPackage(packageDir, ['MyMod.esp'], 'fo4');
    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.fileName).toBe(defaultArchiveFileName('MyMod', 'fo4'));

    const outDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outDir);
    const packed = packBethesdaArchivesIntoDir(packageDir, outDir, [], ['MyMod.esp'], 'fo4');

    expect(packed).toHaveLength(1);
    const ba2Path = packed[0]!.destPath;
    expect(fs.existsSync(ba2Path)).toBe(true);

    const reader = new Ba2Reader(ba2Path);
    try {
      expect(reader.extractByName('Strings\\MyMod_uk.STRINGS')?.toString()).toBe('test');
    } finally {
      reader.close();
    }
  });

  it('refreshes manifest entries when new locale files are added', () => {
    const packageDir = path.join(tmpDir, 'pkg');
    const stringsDir = path.join(packageDir, 'Strings');
    fs.mkdirSync(stringsDir, { recursive: true });
    fs.writeFileSync(path.join(stringsDir, 'MyMod_en.STRINGS'), Buffer.from('en'));
    fs.writeFileSync(path.join(stringsDir, 'MyMod_uk.STRINGS'), Buffer.from('uk'));

    const refreshed = refreshArchiveEntryPaths(packageDir, {
      type: 'ba2',
      fileName: 'MyMod - Main.ba2',
      entries: ['Strings\\MyMod_en.STRINGS'],
    });

    expect(refreshed).toEqual(
      expect.arrayContaining(['Strings\\MyMod_en.STRINGS', 'Strings\\MyMod_uk.STRINGS']),
    );
  });

  it('applies Creation Kit compression for Main BA2 assets', () => {
    const packageDir = path.join(tmpDir, 'pkg');
    const stringsDir = path.join(packageDir, 'Strings');
    const meshesDir = path.join(packageDir, 'Meshes');
    fs.mkdirSync(stringsDir, { recursive: true });
    fs.mkdirSync(meshesDir, { recursive: true });
    fs.writeFileSync(path.join(stringsDir, 'MyMod_uk.STRINGS'), Buffer.from('test'));
    fs.writeFileSync(path.join(meshesDir, 'Armor.nif'), Buffer.alloc(64, 0xcd));

    const outDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outDir);
    packBethesdaArchivesIntoDir(
      packageDir,
      outDir,
      [
        {
          type: 'ba2',
          fileName: 'MyMod - Main.ba2',
          entries: ['Strings\\MyMod_uk.STRINGS', 'Meshes\\Armor.nif'],
        },
      ],
      ['MyMod.esp'],
      'fo4',
    );

    const ba2Path = path.join(outDir, 'MyMod - Main.ba2');
    const ba2 = fs.readFileSync(ba2Path);
    const reader = new Ba2Reader(ba2Path);
    try {
      const names = reader.listFiles();
      expect(names).toEqual(
        expect.arrayContaining(['Strings\\MyMod_uk.STRINGS', 'Meshes\\Armor.nif']),
      );

      const readPackedSize = (name: string): number => {
        const index = names.indexOf(name);
        return ba2.readUInt32LE(24 + index * 36 + 24);
      };
      expect(readPackedSize('Strings\\MyMod_uk.STRINGS')).toBe(0);
      expect(readPackedSize('Meshes\\Armor.nif')).toBeGreaterThan(0);
    } finally {
      reader.close();
    }
  });

  it('collects archiveable folders only', () => {
    const packageDir = path.join(tmpDir, 'pkg');
    fs.mkdirSync(path.join(packageDir, 'Strings'), { recursive: true });
    fs.mkdirSync(path.join(packageDir, 'Docs'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'Strings', 'a.STRINGS'), Buffer.from('a'));
    fs.writeFileSync(path.join(packageDir, 'Docs', 'readme.txt'), Buffer.from('readme'));

    const files = collectArchiveableLooseFiles(packageDir);
    expect(files.map((f) => f.name)).toEqual(['Strings\\a.STRINGS']);
  });
});

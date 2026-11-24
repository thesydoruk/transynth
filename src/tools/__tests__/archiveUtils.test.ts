/**
 * Uploaded archives are unpacked by the current 7-Zip, not the 2016 standalone
 * build that fails a valid Zip64 archive over 4 GiB.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { path7z } from '7z-bin';
import { packFilesToZipPath } from '../../web/export/zipPack';
import { archiveExtractorBin, extractArchive } from '../archiveUtils';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('archive extraction', () => {
  it('uses the current 7-Zip for zip, 7z and rar alike', () => {
    expect(fs.existsSync(path7z)).toBe(true);
    for (const name of ['unit.zip', 'mod.7z', 'mod.rar', 'UNIT.ZIP']) {
      expect(archiveExtractorBin(name)).toBe(path7z);
    }
  });

  it('unpacks a unit zip as the sync packs it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-utils-'));
    tempDirs.push(root);
    const plugin = path.join(root, 'Mod.esp');
    fs.writeFileSync(plugin, Buffer.alloc(2048, 3));
    const zip = path.join(root, 'unit.zip');
    await packFilesToZipPath(
      [
        { name: 'Mod.esp', absPath: plugin },
        { name: 'Strings/Mod_en.STRINGS', data: Buffer.from('tables') },
      ],
      zip,
    );

    const out = path.join(root, 'out');
    await extractArchive(zip, out);

    expect(fs.readFileSync(path.join(out, 'Mod.esp')).equals(Buffer.alloc(2048, 3))).toBe(true);
    expect(fs.readFileSync(path.join(out, 'Strings', 'Mod_en.STRINGS'), 'utf8')).toBe('tables');
  });
});

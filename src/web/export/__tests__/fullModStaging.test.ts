import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import type { Tx } from '../../../db';
import { Ba2Reader, writeBa2 } from '../../../formats/ba2';
import { parseStringsBuffer } from '../../../formats/strings';
import { writeStringsBuffer } from '../../../formats/strings';
import { MOD_IMPORT_MANIFEST_FILE_NAME } from '../../../modImport/archiveManifest';
import { modStorageRoot } from '../../../modStorage/paths';
import { extractGameArchivesForImport } from '../../../import/mod/extract';
import { stageFullLocalizedMod } from '../fullModStaging';

const tempArtifacts: string[] = [];

afterEach(() => {
  while (tempArtifacts.length > 0) {
    const target = tempArtifacts.pop();
    if (target && fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  }
});

const makeDb = (): Tx =>
  ({
    query: async (sql: string) => {
      if (sql.includes('is_localized')) {
        return {
          rows: [{ mod_id: 1, mod_name: 'Demo', src_lang: 'en', game: 'fo4', is_localized: 1 }],
        };
      }
      if (sql.includes('s.lstring_id IS NOT NULL')) {
        return {
          rows: [
            {
              lstring_id: 1,
              signature: 'MESG',
              path: 'MESG\\FULL',
              export_text: 'Привіт',
            },
          ],
        };
      }
      return { rows: [] };
    },
  }) as Tx;

describe('stageFullLocalizedMod', () => {
  it('repacks the full mod with meshes and localized strings', async () => {
    const extractRoot = path.join(modStorageRoot(), `_extracted_test_${Date.now()}`);
    tempArtifacts.push(extractRoot);
    fs.mkdirSync(extractRoot, { recursive: true });

    const stringsBuf = writeStringsBuffer(new Map([[1, 'Hello']]), 'STRINGS');
    const meshesBuf = Buffer.alloc(32, 0xab);
    const ba2 = writeBa2([
      { name: 'Strings\\Demo_en.STRINGS', data: stringsBuf },
      { name: 'Meshes\\Armor.nif', data: meshesBuf },
    ]);
    fs.writeFileSync(path.join(extractRoot, 'Demo - Main.ba2'), ba2);
    fs.writeFileSync(path.join(extractRoot, 'Demo.esp'), Buffer.from('TES4'));
    fs.writeFileSync(path.join(extractRoot, 'readme.txt'), Buffer.from('install me'));

    extractGameArchivesForImport({ extractRoot });

    const pluginPath = path.join(extractRoot, 'Demo.esp');
    const result = await stageFullLocalizedMod(makeDb(), 1, pluginPath, 'en', 'uk', 'fo4');

    try {
      const names = new Set(result.files.map((file) => file.name));
      expect(names.has('Demo.esp')).toBe(true);
      expect(names.has('readme.txt')).toBe(true);
      expect(names.has('Demo - Main.ba2')).toBe(true);
      expect(names.has('Strings/Demo_en.STRINGS')).toBe(false);
      expect(names.has('Meshes/Armor.nif')).toBe(false);

      const ba2File = result.files.find((file) => file.name === 'Demo - Main.ba2');
      expect(ba2File).toBeDefined();

      const ba2Path = path.join(os.tmpdir(), `full-mod-ba2-${Date.now()}.ba2`);
      fs.writeFileSync(ba2Path, ba2File!.data);
      const reader = new Ba2Reader(ba2Path);
      try {
        const stringsBuf = reader.extractByName('Strings\\Demo_en.STRINGS');
        expect(stringsBuf).toBeDefined();
        const parsed = parseStringsBuffer(stringsBuf!, 'STRINGS');
        expect(parsed.get(1)).toBe('Привіт');
        expect(reader.extractByName('Strings\\Demo_ru.STRINGS')).toEqual(stringsBuf);
        expect(reader.extractByName('Strings\\Demo_uk.STRINGS')).toBeNull();
        expect(reader.extractByName('Meshes\\Armor.nif')).toEqual(meshesBuf);
      } finally {
        reader.close();
        fs.unlinkSync(ba2Path);
      }

      expect(fs.existsSync(path.join(extractRoot, MOD_IMPORT_MANIFEST_FILE_NAME))).toBe(true);
    } finally {
      result.cleanup();
    }
  });
});

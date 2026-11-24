/**
 * Interface strings of a mod are found in an unpacked archive, which keeps the
 * case its entries have: Starfield's are `interface/translate_en.txt`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { writeInterfaceTranslateBuffer } from '../../../formats/interface';
import { readModInterfaceFile } from '../../../web/export/modInterfaceFiles';
import { collectInterfaceTranslateLocales } from '../interfaceTranslate';

describe('loose interface translate files', () => {
  let root = '';
  let dir = '';

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'iface-import-'));
    // One level down: with no archive beside the plugin, discovery also walks
    // the folder above it, which must not be the shared temp folder.
    dir = path.join(root, 'unit');
    fs.mkdirSync(dir);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const stage = (folder: string, fileName: string): string => {
    const plugin = path.join(dir, 'Starfield.esm');
    fs.writeFileSync(plugin, Buffer.from('plugin'));
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
    fs.writeFileSync(
      path.join(dir, folder, fileName),
      writeInterfaceTranslateBuffer([
        { key: '$ABORT', text: 'ABORT' },
        { key: '$SHIP', text: 'Ship' },
      ]),
    );
    return plugin;
  };

  it.each([
    ['Interface', 'Translate_en.txt'],
    ['interface', 'translate_en.txt'],
    ['INTERFACE', 'TRANSLATE_EN.TXT'],
  ])('reads %s/%s', (folder, fileName) => {
    const plugin = stage(folder, fileName);

    const locales = collectInterfaceTranslateLocales(dir, plugin);
    expect([...locales.keys()]).toEqual(['en']);
    expect(locales.get('en')?.get('$SHIP')).toBe('Ship');

    // Export asks for the file by the name Fallout 4 gives it.
    const source = readModInterfaceFile(plugin, 'Translate_en.txt');
    expect(source?.equals(fs.readFileSync(path.join(dir, folder, fileName)))).toBe(true);
  });

  it('finds nothing when the mod has no interface folder', () => {
    const plugin = path.join(dir, 'Mod.esm');
    fs.writeFileSync(plugin, Buffer.from('plugin'));
    expect(collectInterfaceTranslateLocales(dir, plugin).size).toBe(0);
    expect(readModInterfaceFile(plugin, 'Translate_en.txt')).toBeNull();
  });
});

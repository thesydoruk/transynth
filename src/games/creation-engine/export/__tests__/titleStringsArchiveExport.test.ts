/**
 * The export side of Starfield's `<Plugin> - Localization.ba2`: source tables
 * are read from it, translated tables go back under its name, and scripts —
 * which it never holds — go to `- Main`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { writeBa2 } from '../../../../formats/ba2';
import { writeStringsBuffer } from '../../../../formats/strings';
import { resolveScriptsArchiveFileName, resolveStringsArchiveFileName } from '../archiveExportPlan';
import { loadSourceStringsFiles } from '../sourceStringsLoader';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

const table = (text: string) => writeStringsBuffer(new Map([[1, text]]), 'STRINGS');

const starfieldData = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-export-'));
  tempDirs.push(root);
  fs.writeFileSync(path.join(root, 'Starfield.esm'), '');
  fs.writeFileSync(
    path.join(root, 'Starfield - Localization.ba2'),
    writeBa2([
      { name: 'strings\\starfield_en.strings', data: table('Constellation') },
      { name: 'strings\\shatteredspace_en.strings', data: table('Dazra') },
    ]),
  );
  fs.writeFileSync(
    path.join(root, 'Starfield - Interface.ba2'),
    writeBa2([{ name: 'interface\\translate_en.txt', data: Buffer.from('$PLAY\tPlay') }]),
  );
  return root;
};

const tempData = (prefix: string): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(root);
  return root;
};

/** A plugin file with a real TES4 header naming its masters. */
const pluginWithMasters = (file: string, masters: string[]): void => {
  const data = Buffer.concat(
    masters.map((name) => {
      const text = Buffer.from(`${name}\0`, 'utf8');
      const head = Buffer.alloc(6);
      head.write('MAST', 0, 'ascii');
      head.writeUInt16LE(text.length, 4);
      return Buffer.concat([head, text]);
    }),
  );
  const header = Buffer.alloc(24);
  header.write('TES4', 0, 'ascii');
  header.writeUInt32LE(data.length, 4);
  fs.writeFileSync(file, Buffer.concat([header, data]));
};

const sourceTables = (plugin: string, game: 'sf1' | 'fo4') =>
  loadSourceStringsFiles(plugin, 'en', game).map((f) => [f.sourceFileName, f.sourceMap.get(1)]);

describe('Starfield string-table archive on export', () => {
  it("loads only the plugin's own source tables from the Localization archive", () => {
    const root = starfieldData();
    const files = loadSourceStringsFiles(path.join(root, 'Starfield.esm'), 'en', 'sf1');

    expect(files.map((f) => [f.sourceFileName, f.sourceMap.get(1)])).toEqual([
      ['starfield_en.strings', 'Constellation'],
    ]);
  });

  it('names the strings archive after the title and sends scripts to Main', () => {
    const root = starfieldData();
    const plugin = path.join(root, 'Starfield.esm');

    expect(resolveStringsArchiveFileName(plugin, 'Starfield', 'sf1')).toBe(
      'Starfield - Localization.ba2',
    );
    expect(resolveScriptsArchiveFileName('Starfield', 'Starfield - Localization.ba2', 'sf1')).toBe(
      'Starfield - Main.ba2',
    );
  });

  it("loads the plugin's own tables from an archive that also holds another plugin's", () => {
    const root = tempData('sf-export-two-');
    fs.writeFileSync(path.join(root, 'SFBGS050.esm'), '');
    fs.writeFileSync(
      path.join(root, 'SFBGS050 - Main.ba2'),
      writeBa2([
        { name: 'strings\\blueprintships-sfbgs050_en.strings', data: table('Ship part') },
        { name: 'strings\\sfbgs050_en.strings', data: table('Terran Armada') },
      ]),
    );

    expect(sourceTables(path.join(root, 'SFBGS050.esm'), 'sf1')).toEqual([
      ['sfbgs050_en.strings', 'Terran Armada'],
    ]);
  });

  it('loads tables from a numbered archive when the companion has none', () => {
    const root = tempData('sf-export-main02-');
    fs.writeFileSync(path.join(root, 'ShatteredSpace.esm'), '');
    fs.writeFileSync(
      path.join(root, 'ShatteredSpace - Main.ba2'),
      writeBa2([{ name: 'meshes\\dazra.nif', data: Buffer.from('nif') }]),
    );
    fs.writeFileSync(
      path.join(root, 'ShatteredSpace - Main02.ba2'),
      writeBa2([{ name: 'strings\\shatteredspace_en.strings', data: table('Dazra') }]),
    );

    expect(sourceTables(path.join(root, 'ShatteredSpace.esm'), 'sf1')).toEqual([
      ['shatteredspace_en.strings', 'Dazra'],
    ]);
  });

  it("loads a plugin's tables from its master's archive, and only its own", () => {
    const root = tempData('sf-export-master-');
    pluginWithMasters(path.join(root, 'SFBGS050.esm'), ['Starfield.esm']);
    pluginWithMasters(path.join(root, 'BlueprintShips-SFBGS050.esm'), [
      'Starfield.esm',
      'SFBGS050.esm',
    ]);
    fs.writeFileSync(
      path.join(root, 'SFBGS050 - Main.ba2'),
      writeBa2([
        { name: 'strings\\sfbgs050_en.strings', data: table('Terran Armada') },
        { name: 'strings\\blueprintships-sfbgs050_en.strings', data: table('Ship part') },
      ]),
    );

    expect(sourceTables(path.join(root, 'BlueprintShips-SFBGS050.esm'), 'sf1')).toEqual([
      ['blueprintships-sfbgs050_en.strings', 'Ship part'],
    ]);
  });

  it('reads a Fallout 4 companion whole when no table is named for the plugin', () => {
    const root = tempData('fo4-export-renamed-');
    fs.writeFileSync(path.join(root, 'Mod.esp'), '');
    fs.writeFileSync(
      path.join(root, 'Mod - Main.ba2'),
      writeBa2([{ name: 'strings\\oldname_en.strings', data: table('Renamed') }]),
    );

    expect(sourceTables(path.join(root, 'Mod.esp'), 'fo4')).toEqual([
      ['oldname_en.strings', 'Renamed'],
    ]);
  });

  it("prefers a Fallout 4 plugin's own tables in its companion archive", () => {
    const root = tempData('fo4-export-shared-');
    fs.writeFileSync(path.join(root, 'Mod.esp'), '');
    fs.writeFileSync(
      path.join(root, 'Mod - Main.ba2'),
      writeBa2([
        { name: 'strings\\mod_en.strings', data: table('Mine') },
        { name: 'strings\\modaddon_en.strings', data: table('Addon') },
      ]),
    );

    expect(sourceTables(path.join(root, 'Mod.esp'), 'fo4')).toEqual([['mod_en.strings', 'Mine']]);
  });

  it('keeps Fallout 4 on its Creation Kit names', () => {
    expect(resolveScriptsArchiveFileName('Mod', 'Mod - Interface.ba2', 'fo4')).toBe(
      'Mod - Main.ba2',
    );
    expect(resolveScriptsArchiveFileName('Mod', 'Mod - Localization.ba2', 'fo4')).toBe(
      'Mod - Localization.ba2',
    );
  });
});

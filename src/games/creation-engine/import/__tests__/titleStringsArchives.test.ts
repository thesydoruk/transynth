/**
 * Starfield keeps a plugin's string tables in `<Plugin> - Localization.ba2`,
 * not in the Creation Kit's `- Main` / `- Interface`. The title says so, and
 * discovery reads that archive first and takes only the plugin's own tables.
 *
 * The fixture archives are Fallout 4 GNRL BA2s: the shape of the tree is what
 * is under test, not the archive version.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { clearBa2Cache, writeBa2 } from '../../../../formats/ba2';
import { writeStringsBuffer } from '../../../../formats/strings';
import { fallout4 } from '../../titles/fallout';
import { starfield } from '../../titles/starfield';
import { discoverLocaleSources, findTitleStringsArchives } from '../localeSources';

const tempDirs: string[] = [];

afterEach(() => {
  clearBa2Cache();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

const table = (text: string) => writeStringsBuffer(new Map([[1, text]]), 'STRINGS');

/** A Starfield `Data` folder: the master, its Localization and Interface archives. */
const starfieldData = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-data-'));
  tempDirs.push(root);
  fs.writeFileSync(path.join(root, 'Starfield.esm'), '');
  fs.writeFileSync(
    path.join(root, 'Starfield - Localization.ba2'),
    writeBa2([
      { name: 'strings\\starfield_en.strings', data: table('Constellation') },
      { name: 'strings\\starfield_de.strings', data: table('Konstellation') },
      { name: 'strings\\shatteredspace_en.strings', data: table('Dazra') },
    ]),
  );
  fs.writeFileSync(
    path.join(root, 'Starfield - Interface.ba2'),
    writeBa2([{ name: 'interface\\translate_en.txt', data: Buffer.from('$PLAY\tPlay') }]),
  );
  return root;
};

const summarize = (sources: ReturnType<typeof discoverLocaleSources>) =>
  Object.fromEntries(
    sources.map((source) => [
      source.locale,
      source.files.map((file) =>
        file.kind === 'loose'
          ? path.basename(file.filePath)
          : // The Creation Kit lookup reports the archive name lowercased.
            `${path.basename(file.archivePath).toLowerCase()}:${file.entryName}`,
      ),
    ]),
  );

describe('findTitleStringsArchives', () => {
  it('finds <stem><suffix>.ba2 among candidates or on disk, in the title order', () => {
    const root = starfieldData();
    const plugin = path.join(root, 'Starfield.esm');
    const localization = path.join(root, 'Starfield - Localization.ba2');

    expect(findTitleStringsArchives(plugin, [], [' - Localization'])).toEqual([localization]);
    expect(findTitleStringsArchives(plugin, [localization], [' - Localization'])).toEqual([
      localization,
    ]);
    expect(findTitleStringsArchives(plugin, [], [' - Strings'])).toEqual([]);
    expect(findTitleStringsArchives(plugin, [], [])).toEqual([]);
  });
});

describe('discoverLocaleSources for Starfield', () => {
  it("reads the plugin's own tables from its Localization archive", () => {
    const root = starfieldData();
    const plugin = path.join(root, 'Starfield.esm');

    expect(summarize(discoverLocaleSources(plugin, starfield))).toEqual({
      de: ['starfield - localization.ba2:strings\\starfield_de.strings'],
      en: ['starfield - localization.ba2:strings\\starfield_en.strings'],
    });
  });

  it('prefers loose tables, as the engine does', () => {
    const root = starfieldData();
    fs.mkdirSync(path.join(root, 'Strings'));
    fs.writeFileSync(path.join(root, 'Strings', 'Starfield_en.STRINGS'), table('Loose'));

    expect(summarize(discoverLocaleSources(path.join(root, 'Starfield.esm'), starfield))).toEqual({
      en: ['Starfield_en.STRINGS'],
    });
  });

  it('leaves a title without string-table archives on its Creation Kit names', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fo4-data-'));
    tempDirs.push(root);
    fs.writeFileSync(path.join(root, 'Mod.esp'), '');
    fs.writeFileSync(
      path.join(root, 'Mod - Main.ba2'),
      writeBa2([{ name: 'strings\\mod_en.strings', data: table('Main') }]),
    );

    expect(summarize(discoverLocaleSources(path.join(root, 'Mod.esp'), fallout4))).toEqual({
      en: ['mod - main.ba2:strings\\mod_en.strings'],
    });
  });
});

/** A plugin file with a real TES4 header naming its masters. */
const pluginWithMasters = (file: string, masters: string[]): void => {
  const subs = masters.map((name) => {
    const data = Buffer.from(`${name}\0`, 'utf8');
    const head = Buffer.alloc(6);
    head.write('MAST', 0, 'ascii');
    head.writeUInt16LE(data.length, 4);
    return Buffer.concat([head, data]);
  });
  const data = Buffer.concat(subs);
  const header = Buffer.alloc(24);
  header.write('TES4', 0, 'ascii');
  header.writeUInt32LE(data.length, 4);
  fs.writeFileSync(file, Buffer.concat([header, data]));
};

const tempData = (prefix: string): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(root);
  return root;
};

/**
 * What the import passes as candidates: every archive beside the plugin (the
 * import's own lookup would walk the parent — the shared temp folder — when
 * there is none).
 */
const discover = (plugin: string, title: typeof starfield) => {
  const dir = path.dirname(plugin);
  const candidates = fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.ba2'))
    .map((name) => path.join(dir, name));
  return summarize(discoverLocaleSources(plugin, title, candidates));
};

describe('discoverLocaleSources where Starfield add-ons keep their tables', () => {
  it("takes the plugin's own tables from an archive that also holds another plugin's", () => {
    const root = tempData('sf-two-plugins-');
    pluginWithMasters(path.join(root, 'SFBGS050.esm'), ['Starfield.esm']);
    fs.writeFileSync(
      path.join(root, 'SFBGS050 - Main.ba2'),
      writeBa2([
        { name: 'strings\\blueprintships-sfbgs050_en.strings', data: table('Ship part') },
        { name: 'strings\\sfbgs050_en.strings', data: table('Terran Armada') },
        { name: 'strings\\sfbgs050_de.strings', data: table('Terranische Armada') },
      ]),
    );

    expect(discover(path.join(root, 'SFBGS050.esm'), starfield)).toEqual({
      de: ['sfbgs050 - main.ba2:strings\\sfbgs050_de.strings'],
      en: ['sfbgs050 - main.ba2:strings\\sfbgs050_en.strings'],
    });
  });

  it('finds tables in a numbered archive when the first one has none', () => {
    const root = tempData('sf-main02-');
    pluginWithMasters(path.join(root, 'ShatteredSpace.esm'), ['Starfield.esm']);
    fs.writeFileSync(
      path.join(root, 'ShatteredSpace - Main01.ba2'),
      writeBa2([{ name: 'meshes\\dazra.nif', data: Buffer.from('nif') }]),
    );
    fs.writeFileSync(
      path.join(root, 'ShatteredSpace - Main02.ba2'),
      writeBa2([{ name: 'strings\\shatteredspace_en.strings', data: table('Dazra') }]),
    );

    expect(discover(path.join(root, 'ShatteredSpace.esm'), starfield)).toEqual({
      en: ['shatteredspace - main02.ba2:strings\\shatteredspace_en.strings'],
    });
  });

  it("reads a plugin's tables from its master's archive, and only its own", () => {
    const root = tempData('sf-master-archive-');
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

    expect(discover(path.join(root, 'BlueprintShips-SFBGS050.esm'), starfield)).toEqual({
      en: ['sfbgs050 - main.ba2:strings\\blueprintships-sfbgs050_en.strings'],
    });
  });

  it("takes nothing from a master's archive that holds no table named for the plugin", () => {
    const root = tempData('sf-master-none-');
    pluginWithMasters(path.join(root, 'SFBGS050.esm'), ['Starfield.esm']);
    pluginWithMasters(path.join(root, 'Patch.esm'), ['SFBGS050.esm']);
    fs.writeFileSync(
      path.join(root, 'SFBGS050 - Main.ba2'),
      writeBa2([{ name: 'strings\\sfbgs050_en.strings', data: table('Terran Armada') }]),
    );

    expect(discover(path.join(root, 'Patch.esm'), starfield)).toEqual({});
  });
});

describe('discoverLocaleSources for Fallout 4, unchanged', () => {
  it('reads a companion archive whole when no table in it is named for the plugin', () => {
    const root = tempData('fo4-renamed-');
    fs.writeFileSync(path.join(root, 'Mod.esp'), '');
    fs.writeFileSync(
      path.join(root, 'Mod - Main.ba2'),
      writeBa2([{ name: 'strings\\oldname_en.strings', data: table('Renamed') }]),
    );

    expect(discover(path.join(root, 'Mod.esp'), fallout4)).toEqual({
      en: ['mod - main.ba2:strings\\oldname_en.strings'],
    });
  });

  it("prefers the plugin's own tables in a shared companion archive", () => {
    const root = tempData('fo4-shared-');
    fs.writeFileSync(path.join(root, 'Mod.esp'), '');
    fs.writeFileSync(
      path.join(root, 'Mod - Main.ba2'),
      writeBa2([
        { name: 'strings\\mod_en.strings', data: table('Mine') },
        { name: 'strings\\modaddon_en.strings', data: table('Addon') },
      ]),
    );

    expect(discover(path.join(root, 'Mod.esp'), fallout4)).toEqual({
      en: ['mod - main.ba2:strings\\mod_en.strings'],
    });
  });

  it('finds nothing for a plugin with no archive whose master has none', () => {
    const root = tempData('fo4-none-');
    pluginWithMasters(path.join(root, 'Mod.esp'), ['Fallout4.esm']);
    fs.writeFileSync(path.join(root, 'Fallout4.esm'), '');

    expect(discover(path.join(root, 'Mod.esp'), fallout4)).toEqual({});
  });
});

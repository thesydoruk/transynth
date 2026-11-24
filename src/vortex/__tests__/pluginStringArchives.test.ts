/**
 * A game unit carries the archive that holds its plugin's string tables, also
 * when that archive is not one of the usual roles.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { writeBa2 } from '../../formats/ba2';
import { writeStringsBuffer } from '../../formats/strings';
import { collectNamedPluginFiles } from '../collectSubset';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const dataDir = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-tables-'));
  tempDirs.push(root);
  return root;
};

const table = (text: string) => writeStringsBuffer(new Map([[1, text]]), 'STRINGS');

/** A plugin file with a real TES4 header: the localized flag and its masters. */
const plugin = (file: string, opts: { localized?: boolean; masters?: string[] } = {}): void => {
  const subs = (opts.masters ?? []).map((name) => {
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
  header.writeUInt32LE(opts.localized === false ? 0 : 0x80, 8);
  fs.writeFileSync(file, Buffer.concat([header, data]));
};

const archive = (file: string, names: string[]): void => {
  fs.writeFileSync(file, writeBa2(names.map((name) => ({ name, data: table(name) }))));
};

const unitFiles = (root: string, pluginFileName: string): string[] =>
  collectNamedPluginFiles(root, pluginFileName)
    .map((file) => file.relPath)
    .sort();

describe('string tables outside the usual archives', () => {
  it('adds the numbered Main archive that holds the tables, and only that one', () => {
    const root = dataDir();
    plugin(path.join(root, 'ShatteredSpace.esm'), { masters: ['Starfield.esm'] });
    archive(path.join(root, 'ShatteredSpace - Main01.ba2'), ['meshes\\dazra.nif']);
    archive(path.join(root, 'ShatteredSpace - Main02.ba2'), ['strings\\shatteredspace_en.strings']);
    archive(path.join(root, 'ShatteredSpace - Voices_en.ba2'), ['sound\\voice\\a.wem']);

    expect(unitFiles(root, 'ShatteredSpace.esm')).toEqual([
      'ShatteredSpace - Main02.ba2',
      'ShatteredSpace - Voices_en.ba2',
      'ShatteredSpace.esm',
    ]);
  });

  it("adds the master's archive when the plugin's tables live there", () => {
    const root = dataDir();
    plugin(path.join(root, 'Starfield.esm'));
    plugin(path.join(root, 'SFBGS050.esm'), { masters: ['Starfield.esm'] });
    plugin(path.join(root, 'BlueprintShips-SFBGS050.esm'), {
      masters: ['Starfield.esm', 'SFBGS050.esm'],
    });
    archive(path.join(root, 'Starfield - Localization.ba2'), ['strings\\starfield_en.strings']);
    archive(path.join(root, 'SFBGS050 - Main.ba2'), [
      'strings\\sfbgs050_en.strings',
      'strings\\blueprintships-sfbgs050_en.strings',
    ]);

    expect(unitFiles(root, 'BlueprintShips-SFBGS050.esm')).toEqual([
      'BlueprintShips-SFBGS050.esm',
      'SFBGS050 - Main.ba2',
    ]);
    // The master's own unit is what it was.
    expect(unitFiles(root, 'SFBGS050.esm')).toEqual(['SFBGS050 - Main.ba2', 'SFBGS050.esm']);
  });

  it('adds nothing when a carried archive or a loose file has the tables', () => {
    const root = dataDir();
    plugin(path.join(root, 'DLCCoast.esm'), { masters: ['Fallout4.esm'] });
    archive(path.join(root, 'DLCCoast - Main.ba2'), ['strings\\dlccoast_en.strings']);
    archive(path.join(root, 'DLCCoast - Main02.ba2'), ['strings\\dlccoast_en.strings']);
    expect(unitFiles(root, 'DLCCoast.esm')).toEqual(['DLCCoast - Main.ba2', 'DLCCoast.esm']);

    plugin(path.join(root, 'Loose.esm'));
    fs.mkdirSync(path.join(root, 'Strings'));
    fs.writeFileSync(path.join(root, 'Strings', 'Loose_en.STRINGS'), table('Loose'));
    archive(path.join(root, 'Loose - Main02.ba2'), ['strings\\loose_en.strings']);
    expect(unitFiles(root, 'Loose.esm')).toEqual(['Loose.esm', 'Strings/Loose_en.STRINGS']);
  });

  it('adds nothing for a plugin that is not localized or has no tables anywhere', () => {
    const root = dataDir();
    plugin(path.join(root, 'Plain.esm'), { localized: false });
    archive(path.join(root, 'Plain - Main02.ba2'), ['strings\\plain_en.strings']);
    expect(unitFiles(root, 'Plain.esm')).toEqual(['Plain.esm']);

    plugin(path.join(root, 'Empty.esm'), { masters: ['Plain.esm'] });
    archive(path.join(root, 'Empty - Main02.ba2'), ['meshes\\a.nif']);
    expect(unitFiles(root, 'Empty.esm')).toEqual(['Empty.esm']);
  });
});

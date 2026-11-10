import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { writeStringsBuffer } from '../../../formats/strings';
import { loadSourceStringsFiles } from '../sourceStringsLoader';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Two plugins share one folder and one `Strings/`; their lstring ids collide,
 * as they do in real mods, because ids are numbered per plugin.
 */
const twoPluginTree = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'export-two-plugins-'));
  tempDirs.push(root);
  fs.writeFileSync(path.join(root, 'SS2.esm'), '');
  fs.writeFileSync(path.join(root, 'SS2Extended.esp'), '');
  const dir = path.join(root, 'Strings');
  fs.mkdirSync(dir);
  const write = (name: string, text: string, type: 'STRINGS' | 'DLSTRINGS'): void =>
    fs.writeFileSync(path.join(dir, name), writeStringsBuffer(new Map([[1, text]]), type));
  write('SS2_en.STRINGS', 'Settler', 'STRINGS');
  write('ss2_en.DLSTRINGS', 'A note', 'DLSTRINGS');
  write('SS2Extended_en.STRINGS', 'Extended settler', 'STRINGS');
  write('SS2Extended_de.STRINGS', 'Siedler', 'STRINGS');
  return root;
};

const summarize = (pluginPath: string) =>
  loadSourceStringsFiles(pluginPath, 'en', 'fo4').map((file) => ({
    sourceFileName: file.sourceFileName,
    nameStem: file.nameStem,
    text: file.sourceMap.get(1),
  }));

describe('loadSourceStringsFiles with several plugins in one Strings dir', () => {
  it("loads only the plugin's own tables, keeping their file-name casing", () => {
    const root = twoPluginTree();

    expect(summarize(path.join(root, 'SS2.esm'))).toEqual([
      { sourceFileName: 'SS2_en.STRINGS', nameStem: 'SS2', text: 'Settler' },
      { sourceFileName: 'ss2_en.DLSTRINGS', nameStem: 'ss2', text: 'A note' },
    ]);
    expect(summarize(path.join(root, 'SS2Extended.esp'))).toEqual([
      {
        sourceFileName: 'SS2Extended_en.STRINGS',
        nameStem: 'SS2Extended',
        text: 'Extended settler',
      },
    ]);
  });

  it('returns nothing when only another plugin ships tables for the locale', () => {
    const root = twoPluginTree();
    fs.writeFileSync(path.join(root, 'Other.esp'), '');
    expect(loadSourceStringsFiles(path.join(root, 'Other.esp'), 'en', 'fo4')).toEqual([]);
  });
});

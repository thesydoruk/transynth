import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { fallout4 } from '../../../games/creation-engine/titles/fallout';
import { parsePluginStringsFileName } from '../../stringsPack/constants';
import { discoverLocaleSources } from '../localeSources';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** One extracted folder holding two plugins and both plugins' loose tables. */
const twoPluginTree = (stringsFiles: string[]): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'strings-two-plugins-'));
  tempDirs.push(root);
  fs.writeFileSync(path.join(root, 'SS2.esm'), '');
  fs.writeFileSync(path.join(root, 'SS2_XPAC_Chapter2.esm'), '');
  fs.mkdirSync(path.join(root, 'Strings'));
  for (const file of stringsFiles) {
    fs.writeFileSync(path.join(root, 'Strings', file), Buffer.alloc(0));
  }
  return root;
};

const looseFileNames = (pluginPath: string): Record<string, string[]> =>
  Object.fromEntries(
    discoverLocaleSources(pluginPath, fallout4).map((source) => [
      source.locale,
      source.files
        .map((file) => (file.kind === 'loose' ? path.basename(file.filePath) : ''))
        .sort(),
    ]),
  );

describe('parsePluginStringsFileName', () => {
  it('accepts only the plugin stem, ignoring case', () => {
    expect(parsePluginStringsFileName('ss2_EN.dlstrings', 'SS2')).toEqual({
      stem: 'ss2',
      locale: 'en',
      type: 'DLSTRINGS',
    });
    expect(parsePluginStringsFileName('SS2_XPAC_Chapter2_en.STRINGS', 'SS2')).toBeNull();
    expect(parsePluginStringsFileName('SS2_en.STRINGS', 'SS2_XPAC_Chapter2')).toBeNull();
    expect(parsePluginStringsFileName('readme.txt', 'SS2')).toBeNull();
  });
});

describe('discoverLocaleSources with several plugins in one Strings dir', () => {
  const files = [
    'SS2_en.STRINGS',
    'SS2_en.DLSTRINGS',
    'ss2_fr.ilstrings',
    'SS2_XPAC_Chapter2_en.STRINGS',
    'SS2_XPAC_Chapter2_en.DLSTRINGS',
    'SS2_XPAC_Chapter2_de.STRINGS',
  ];

  it("reads only the plugin's own tables", () => {
    const root = twoPluginTree(files);

    expect(looseFileNames(path.join(root, 'SS2.esm'))).toEqual({
      en: ['SS2_en.DLSTRINGS', 'SS2_en.STRINGS'],
      fr: ['ss2_fr.ilstrings'],
    });
    expect(looseFileNames(path.join(root, 'SS2_XPAC_Chapter2.esm'))).toEqual({
      de: ['SS2_XPAC_Chapter2_de.STRINGS'],
      en: ['SS2_XPAC_Chapter2_en.DLSTRINGS', 'SS2_XPAC_Chapter2_en.STRINGS'],
    });
  });

  it("finds nothing loose when the folder holds only another plugin's tables", () => {
    const root = twoPluginTree(['SS2_XPAC_Chapter2_en.STRINGS']);
    expect(discoverLocaleSources(path.join(root, 'SS2.esm'), fallout4)).toEqual([]);
  });
});

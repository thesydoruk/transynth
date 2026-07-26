import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { resolveLooseStringsDirForPlugin } from '../looseStringsDir';
import { discoverLocaleSources } from '../../../import/mod/localeSources';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveLooseStringsDirForPlugin', () => {
  it('finds STRINGS folder regardless of directory casing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'strings-dir-case-'));
    tempDirs.push(root);
    fs.writeFileSync(path.join(root, 'Fallout4.esm'), '');
    fs.mkdirSync(path.join(root, 'STRINGS'));
    fs.writeFileSync(path.join(root, 'STRINGS', 'Fallout4_en.STRINGS'), Buffer.alloc(0));

    expect(resolveLooseStringsDirForPlugin(path.join(root, 'Fallout4.esm'))).toBe(
      path.join(root, 'STRINGS'),
    );
  });
});

describe('discoverLocaleSources loose folder casing', () => {
  it('discovers locales from an uppercase STRINGS directory on Linux', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'strings-locale-case-'));
    tempDirs.push(root);
    const pluginPath = path.join(root, 'Fallout4.esm');
    fs.writeFileSync(pluginPath, '');
    fs.mkdirSync(path.join(root, 'STRINGS'));
    fs.writeFileSync(path.join(root, 'STRINGS', 'Fallout4_en.STRINGS'), Buffer.alloc(0));
    fs.writeFileSync(path.join(root, 'STRINGS', 'Fallout4_en.DLSTRINGS'), Buffer.alloc(0));

    const sources = discoverLocaleSources(pluginPath, 'fo4');
    expect(sources.map((s) => s.locale)).toContain('en');
    expect(sources.find((s) => s.locale === 'en')?.files).toHaveLength(2);
  });
});

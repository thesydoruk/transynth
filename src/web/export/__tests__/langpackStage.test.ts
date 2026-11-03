import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { writeLangpackEntriesToDir } from '../langpackStage';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('writeLangpackEntriesToDir', () => {
  it('leaves an entry already at its destination in place instead of copying it over itself', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'langpack-stage-'));
    tempDirs.push(root);
    const inPlace = path.join(root, 'UASoundPack - Main.ba2');
    fs.writeFileSync(inPlace, Buffer.from('archive-bytes'));
    const elsewhere = path.join(root, 'src.txt');
    fs.writeFileSync(elsewhere, Buffer.from('copied'));

    const written = writeLangpackEntriesToDir(root, [
      { name: 'UASoundPack - Main.ba2', absPath: inPlace },
      { name: 'Data/Interface/Translate_uk.txt', absPath: elsewhere },
      { name: 'Strings/Mod_uk.STRINGS', data: Buffer.from('inline') },
    ]);

    expect(written).toBe(3);
    expect(fs.readFileSync(inPlace).toString()).toBe('archive-bytes');
    expect(fs.readFileSync(path.join(root, 'Interface', 'Translate_uk.txt')).toString()).toBe(
      'copied',
    );
    expect(fs.readFileSync(path.join(root, 'Strings', 'Mod_uk.STRINGS')).toString()).toBe('inline');
  });

  it('refuses a path that escapes the staging root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'langpack-stage-escape-'));
    tempDirs.push(root);
    expect(() =>
      writeLangpackEntriesToDir(root, [{ name: '../outside.txt', data: Buffer.from('x') }]),
    ).toThrow(/outside staging/);
  });
});

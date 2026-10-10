import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { listW3StringsFiles, resolveW3SourceLang, w3StringsLangFromFileName } from '../packLayout';

let root: string;

const touch = (...segments: string[]): void => {
  const file = path.join(root, ...segments);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'w3layout-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('w3StringsLangFromFileName', () => {
  it('reads the language code from the stem', () => {
    expect(w3StringsLangFromFileName('en.w3strings')).toBe('en');
    expect(w3StringsLangFromFileName('ESMX.w3strings')).toBe('esmx');
  });

  it('rejects anything else', () => {
    expect(w3StringsLangFromFileName('en.w3strings.csv')).toBeNull();
    expect(w3StringsLangFromFileName('english.w3strings')).toBeNull();
    expect(w3StringsLangFromFileName('enpc.w3speech')).toBeNull();
  });
});

describe('listW3StringsFiles', () => {
  it('groups tables by the folder they sit in, at every level', () => {
    touch('content', 'content0', 'en.w3strings');
    touch('content', 'content0', 'pl.w3strings');
    touch('dlc', 'ep1', 'content', 'en.w3strings');
    touch('mods', 'modFoo', 'content', 'en.w3strings');
    touch('content', 'content0', 'bundles', 'en.w3strings');

    const files = listW3StringsFiles(root).map((f) => `${f.contentDir}|${f.lang}`);
    expect(files).toEqual([
      'content/content0|en',
      'content/content0|pl',
      'dlc/ep1/content|en',
      'mods/modFoo/content|en',
    ]);
  });
});

describe('resolveW3SourceLang', () => {
  it('prefers the requested language, then English, then the most common', () => {
    touch('a', 'pl.w3strings');
    touch('b', 'pl.w3strings');
    touch('a', 'ru.w3strings');
    const files = listW3StringsFiles(root);
    expect(resolveW3SourceLang(files, 'ru')).toBe('ru');
    expect(resolveW3SourceLang(files, 'en')).toBe('pl');

    touch('a', 'en.w3strings');
    expect(resolveW3SourceLang(listW3StringsFiles(root), 'de')).toBe('en');
  });

  it('is null for a tree with no tables', () => {
    expect(resolveW3SourceLang([], 'en')).toBeNull();
  });
});

describe('witcher3TextAdapter', () => {
  it('keeps Elder Speech as one opaque slot and leaves the gloss to translate', async () => {
    const { witcher3TextAdapter } = await import('../text');
    const { masked, mapping } = witcher3TextAdapter.maskMarkup(
      "{Vatt'ghern? } [A witcher?] {Cáemm…}",
    );
    expect(masked).toBe('¤EM0¤ [A witcher?] ¤EM1¤');
    expect(mapping).toEqual({ '¤EM0¤': "{Vatt'ghern? }", '¤EM1¤': '{Cáemm…}' });
  });
});

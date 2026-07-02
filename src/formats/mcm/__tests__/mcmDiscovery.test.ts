import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  mcmTranslationMatchesMod,
  mcmFileStemFromPath,
  resolveMcmLocaleKey,
  isMcmTranslationArchivePath,
  resolveMcmModPrefix,
  resolveModDirectoryFromPath,
  findFirstMcmTranslationFile,
  hasMcmTranslationFiles,
} from '../mcmDiscovery';

describe('mcmTranslationMatchesMod', () => {
  it('matches standard MCM Helper file names', () => {
    expect(mcmTranslationMatchesMod('Dank_LEO_en.txt', 'Dank_LEO')).toBe(true);
    expect(mcmTranslationMatchesMod('Dank_LEO_ptbr.txt', 'Dank_LEO')).toBe(true);
    expect(mcmTranslationMatchesMod('OtherMod_en.txt', 'Dank_LEO')).toBe(false);
  });

  it('matches FallUI-style custom stems', () => {
    expect(mcmTranslationMatchesMod('FallUIInv_en.txt', 'FallUI')).toBe(true);
    expect(mcmTranslationMatchesMod('MCM_FallUIInv_en.txt', 'FallUI')).toBe(true);
    expect(mcmTranslationMatchesMod('FallUIInv_en.txt', ['FallUI', 'FallUIInv'])).toBe(true);
  });
});

describe('mcmFileStemFromPath', () => {
  it('extracts stem before locale suffix', () => {
    expect(mcmFileStemFromPath('FallUIInv_en.txt')).toBe('FallUIInv');
    expect(mcmFileStemFromPath('MCM/Config/FallUI/Translation/MCM_FallUIInv_ru.txt')).toBe(
      'MCM_FallUIInv',
    );
  });
});

describe('isMcmTranslationArchivePath', () => {
  it('accepts Translation and Translations archive paths', () => {
    expect(isMcmTranslationArchivePath('Interface\\Translations\\Mod_en.txt')).toBe(true);
    expect(
      isMcmTranslationArchivePath('interface\\FallUI Inventory\\Translation\\FallUIInv_en.txt'),
    ).toBe(true);
    expect(isMcmTranslationArchivePath('Strings\\Mod_en.STRINGS')).toBe(false);
  });
});

describe('resolveMcmModPrefix', () => {
  it('uses file stem without locale for MCM translation txt anchors', () => {
    expect(resolveMcmModPrefix('/mod', 'MCM_FallUIInv_ru.txt')).toBe('MCM_FallUIInv');
  });
});

describe('MCM-only translation patches', () => {
  it('finds translation files and mod root in a patch folder layout', () => {
    const modDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcm-patch-'));
    const transDir = path.join(modDir, 'MCM', 'Config', 'FallUI', 'Translation');
    fs.mkdirSync(transDir, { recursive: true });
    fs.writeFileSync(path.join(transDir, 'MCM_FallUIInv_ru.txt'), '$Key=Value\n', 'utf8');

    const txtPath = findFirstMcmTranslationFile(modDir);
    expect(txtPath).toBe(path.join(transDir, 'MCM_FallUIInv_ru.txt'));
    expect(hasMcmTranslationFiles(modDir)).toBe(true);
    expect(resolveModDirectoryFromPath(txtPath!)).toBe(modDir);

    fs.rmSync(modDir, { recursive: true, force: true });
  });
});

describe('resolveMcmLocaleKey', () => {
  it('resolves short and extended Fallout 4 locale codes', () => {
    const locales = new Map([
      ['en', new Map([['$k', 'English']])],
      ['cn', new Map([['$k', 'Chinese']])],
      ['ptbr', new Map([['$k', 'Portuguese']])],
      ['esmx', new Map([['$k', 'Spanish MX']])],
    ]);

    expect(resolveMcmLocaleKey(locales, 'en')?.resolvedKey).toBe('en');
    expect(resolveMcmLocaleKey(locales, 'english')?.resolvedKey).toBe('en');
    expect(resolveMcmLocaleKey(locales, 'zh')?.resolvedKey).toBe('cn');
    expect(resolveMcmLocaleKey(locales, 'pt')?.resolvedKey).toBe('ptbr');
    expect(resolveMcmLocaleKey(locales, 'esmx')?.resolvedKey).toBe('esmx');
  });
});

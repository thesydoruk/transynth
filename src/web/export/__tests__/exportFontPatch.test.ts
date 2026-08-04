import { describe, it, expect, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BOX_OUTLINE,
  placeholderFontLibrary,
  UKRAINIAN_I,
} from '../../../formats/swf/__tests__/swfFixtures';
import { parseDefineFontTag } from '../../../formats/swf/defineFontTag';
import { parseSwf } from '../../../formats/swf/swfTags';
import { exportPatchedFontLibraries } from '../exportFontPatch';

const tempDirs: string[] = [];

/** Lay out a mod package with the given font libraries under `Interface/`. */
const stageMod = (fonts: Record<string, Buffer>): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transynth-fonts-'));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'Interface'), { recursive: true });
  for (const [fileName, data] of Object.entries(fonts)) {
    fs.writeFileSync(path.join(dir, 'Interface', fileName), data);
  }
  const pluginPath = path.join(dir, 'TerminalMod.esp');
  fs.writeFileSync(pluginPath, Buffer.alloc(0));
  return pluginPath;
};

const shapeOf = (swf: Buffer, codePoint: number): Buffer => {
  const fontTag = parseSwf(swf).tags.find((t) => t.code === 75)!;
  const font = parseDefineFontTag(fontTag.body)!;
  return font.shapes[font.codePoints.indexOf(codePoint)]!;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('exportPatchedFontLibraries', () => {
  it('repairs the font libraries of every locale slot Ukrainian replaces', () => {
    const pluginPath = stageMod({
      'fonts_en.swf': placeholderFontLibrary(),
      'fonts_ru.swf': placeholderFontLibrary(),
    });

    const patched = exportPatchedFontLibraries(pluginPath, 'uk');

    expect(patched.map((file) => file.archivePath)).toEqual([
      'Interface/fonts_en.swf',
      'Interface/fonts_ru.swf',
    ]);
    for (const file of patched) {
      expect(shapeOf(file.buffer, UKRAINIAN_I)).not.toEqual(BOX_OUTLINE);
      expect(file.repaired).toEqual(['і', 'ї', 'є', 'ґ']);
    }
  });

  it('skips slots the mod does not ship a font for', () => {
    const pluginPath = stageMod({ 'fonts_ru.swf': placeholderFontLibrary() });

    expect(exportPatchedFontLibraries(pluginPath, 'uk').map((f) => f.archivePath)).toEqual([
      'Interface/fonts_ru.swf',
    ]);
  });

  it('leaves a mod without fonts to export as it always did', () => {
    expect(exportPatchedFontLibraries(stageMod({}), 'uk')).toEqual([]);
  });

  it('does nothing for a language the game ships fonts for', () => {
    const pluginPath = stageMod({ 'fonts_ru.swf': placeholderFontLibrary() });

    expect(exportPatchedFontLibraries(pluginPath, 'ru')).toEqual([]);
    expect(exportPatchedFontLibraries(pluginPath, 'pl')).toEqual([]);
  });

  it('does nothing for an unofficial language with no known repairs', () => {
    const pluginPath = stageMod({ 'fonts_en.swf': placeholderFontLibrary() });

    expect(exportPatchedFontLibraries(pluginPath, 'kk')).toEqual([]);
  });

  it('skips a library that needs no repair', () => {
    const pluginPath = stageMod({ 'fonts_en.swf': placeholderFontLibrary() });
    const once = exportPatchedFontLibraries(pluginPath, 'uk');
    fs.writeFileSync(
      path.join(path.dirname(pluginPath), 'Interface', 'fonts_en.swf'),
      once[0]!.buffer,
    );

    expect(exportPatchedFontLibraries(pluginPath, 'uk')).toEqual([]);
  });

  it('survives a font library it cannot parse', () => {
    const pluginPath = stageMod({ 'fonts_en.swf': Buffer.from('not a flash movie') });

    expect(exportPatchedFontLibraries(pluginPath, 'uk')).toEqual([]);
  });
});

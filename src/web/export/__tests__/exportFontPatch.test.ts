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
import { exportPatchedFontFiles } from '../exportFontPatch';

const tempDirs: string[] = [];

const VANILLA_FONT_CONFIG = [
  'fontlib "Interface\\fonts_en.swf"',
  'map "$MAIN_Font" = "Roboto Condensed" Normal',
  'map "$Terminal_Font" = "Share-TechMono Regular" Normal',
  'map "$HandwrittenFont" = "Handwritten_Institute" Normal',
  'map "$Controller_Buttons" = "Controller  Buttons" Normal',
  'validNameChars "abcABC"',
].join('\r\n');

/** Lay out a mod package with the given files under `Interface/`. */
const stageMod = (files: Record<string, Buffer | string>): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transynth-fonts-'));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'Interface'), { recursive: true });
  for (const [fileName, data] of Object.entries(files)) {
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

const textOf = (files: { archivePath: string; buffer: Buffer }[], archivePath: string): string =>
  files.find((f) => f.archivePath === archivePath)!.buffer.toString('utf8');

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('exportPatchedFontFiles', () => {
  it('repairs the font library of every locale slot Ukrainian replaces', () => {
    const pluginPath = stageMod({
      'fonts_en.swf': placeholderFontLibrary(),
      'fonts_ru.swf': placeholderFontLibrary(),
    });

    const files = exportPatchedFontFiles(pluginPath, 'uk');

    expect(files.map((file) => file.archivePath)).toEqual([
      'Interface/fonts_en.swf',
      'Interface/fonts_ru.swf',
    ]);
    for (const file of files) {
      expect(shapeOf(file.buffer, UKRAINIAN_I)).not.toEqual(BOX_OUTLINE);
      expect(file.summary).toBe('rebuilt 4 glyph(s): і ї є ґ');
    }
  });

  it('skips slots the mod does not ship a font for', () => {
    const pluginPath = stageMod({ 'fonts_ru.swf': placeholderFontLibrary() });

    expect(exportPatchedFontFiles(pluginPath, 'uk').map((f) => f.archivePath)).toEqual([
      'Interface/fonts_ru.swf',
    ]);
  });

  it('leaves a mod without interface fonts to export as it always did', () => {
    expect(exportPatchedFontFiles(stageMod({}), 'uk')).toEqual([]);
  });

  it('does nothing for a language the game ships fonts for', () => {
    const pluginPath = stageMod({
      'fonts_ru.swf': placeholderFontLibrary(),
      'FontConfig.txt': VANILLA_FONT_CONFIG,
    });

    expect(exportPatchedFontFiles(pluginPath, 'ru')).toEqual([]);
    expect(exportPatchedFontFiles(pluginPath, 'pl')).toEqual([]);
  });

  it('survives a font library it cannot parse', () => {
    const pluginPath = stageMod({ 'fonts_en.swf': Buffer.from('not a flash movie') });

    expect(exportPatchedFontFiles(pluginPath, 'uk')).toEqual([]);
  });

  it('points a logical font with no Cyrillic at one that has it', () => {
    const pluginPath = stageMod({
      'fonts_en.swf': placeholderFontLibrary(),
      'FontConfig.txt': VANILLA_FONT_CONFIG,
    });

    const config = textOf(exportPatchedFontFiles(pluginPath, 'uk'), 'Interface/FontConfig.txt');

    // Handwritten_Institute is absent from the library, so its mapping is left alone.
    expect(config).toContain('map "$HandwrittenFont" = "Handwritten_Institute" Normal');
    // The terminal font was repaired, so it keeps its mapping.
    expect(config).toContain('map "$Terminal_Font" = "Share-TechMono Regular" Normal');
  });

  it('widens the characters a player may type', () => {
    const pluginPath = stageMod({
      'fonts_en.swf': placeholderFontLibrary(),
      'FontConfig.txt': VANILLA_FONT_CONFIG,
    });

    const files = exportPatchedFontFiles(pluginPath, 'uk');
    const config = textOf(files, 'Interface/FontConfig.txt');

    expect(config).toContain('validNameChars "abcABC');
    expect(config).toContain('ґ');
    expect(config).toContain('Ї');
    expect(config.split('\r\n')).toHaveLength(VANILLA_FONT_CONFIG.split('\r\n').length);
    expect(files.find((f) => f.archivePath === 'Interface/FontConfig.txt')!.summary).toContain(
      'allowed 67 char(s)',
    );
  });

  it('leaves a config alone when the mod ships no library to judge it by', () => {
    const pluginPath = stageMod({ 'FontConfig.txt': 'fontlib "Interface\\fonts_en.swf"' });

    expect(exportPatchedFontFiles(pluginPath, 'uk')).toEqual([]);
  });
});

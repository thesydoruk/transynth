/**
 * Font export for a title whose fonts have no letters of the language at all.
 *
 * Starfield declares `interfaceFonts`: the slot's `.swf` and `.gfx` libraries, a
 * per-slot `fontconfig_<slot>.txt`, and the Japanese set as donor. The fonts below
 * carry Starfield's family names so the title's fallback table applies.
 */
import { describe, it, expect, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSwf } from '../../../formats/swf/__tests__/swfFixtures';
import {
  asGfx,
  fontTag,
  latinGlyphs,
  russianGlyphs,
} from '../../../formats/swf/__tests__/glyphFixtures';
import { readDefineFonts } from '../../../formats/swf';
import { exportPatchedFontFiles } from '../exportFontPatch';

const tempDirs: string[] = [];

const STARFIELD_CONFIG = [
  'fontlib "fonts_en"',
  'map "$MAIN_Font" = "NB Architekt Light" Normal',
  'map "$ConsoleFont" = "Arial" Normal',
  'validNameChars "abcABC"',
].join('\r\n');

/** `fonts_en`: one face the Japanese set also draws, and Arial, which it does not. */
const englishLibrary = (): Buffer =>
  buildSwf([fontTag(1, 'NB Architekt Light', latinGlyphs()), fontTag(2, 'Arial', latinGlyphs(4))]);

const japaneseLibrary = (): Buffer =>
  buildSwf([fontTag(1, 'JP_NB Architekt Light Regular', { ...latinGlyphs(), ...russianGlyphs() })]);

const stagePlugin = (files: Record<string, Buffer | string>): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transynth-sf-fonts-'));
  tempDirs.push(root);
  const dir = path.join(root, 'game');
  fs.mkdirSync(path.join(dir, 'Interface'), { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, 'Interface', name), data);
  }
  const pluginPath = path.join(dir, 'Starfield.esm');
  fs.writeFileSync(pluginPath, Buffer.alloc(0));
  return pluginPath;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('exportPatchedFontFiles for a title with donor fonts', () => {
  const vanilla = {
    'fonts_en.swf': englishLibrary(),
    'fonts_en.gfx': asGfx(englishLibrary()),
    'fonts_ja.swf': japaneseLibrary(),
    'fontconfig_en.txt': STARFIELD_CONFIG,
  };

  it('adds the letters to both libraries of the slot and adapts its config', () => {
    const files = exportPatchedFontFiles(stagePlugin(vanilla), 'uk', 'sf1');

    expect(files.map((f) => f.archivePath)).toEqual([
      'Interface/fonts_en.swf',
      'Interface/fonts_en.gfx',
      'Interface/fontconfig_en.txt',
    ]);
    for (const file of files.slice(0, 2)) {
      const [architekt, arial] = readDefineFonts(file.buffer);
      expect(architekt!.codePoints).toContain('ґ'.codePointAt(0));
      expect(arial!.codePoints).not.toContain('ґ'.codePointAt(0));
      expect(file.summary).toMatch(/^added \d+ glyph\(s\) to NB Architekt Light$/);
    }
    expect(files[1]!.buffer.toString('ascii', 0, 3)).toBe('GFX');
  });

  it('moves a logical font with no donor to the family the title names', () => {
    const files = exportPatchedFontFiles(stagePlugin(vanilla), 'uk', 'sf1');
    const config = files[2]!.buffer.toString('utf8');

    expect(config).toContain('map "$ConsoleFont" = "NB Architekt Light" Normal');
    expect(config).toContain('map "$MAIN_Font" = "NB Architekt Light" Normal');
    expect(config).toContain('ґ');
    expect(config.split('\r\n')).toHaveLength(STARFIELD_CONFIG.split('\r\n').length);
  });

  it('exports nothing for an official language', () => {
    expect(exportPatchedFontFiles(stagePlugin(vanilla), 'pl', 'sf1')).toEqual([]);
  });

  it('leaves the fonts alone when the donor library is missing', () => {
    const { 'fonts_ja.swf': _donor, ...withoutDonor } = vanilla;
    const files = exportPatchedFontFiles(stagePlugin(withoutDonor), 'uk', 'sf1');

    // Nothing can be drawn, so only the typing lists in the config change.
    expect(files.map((f) => f.archivePath)).toEqual(['Interface/fontconfig_en.txt']);
    expect(files[0]!.buffer.toString('utf8')).toContain('map "$MAIN_Font" = "NB Architekt Light"');
  });
});

import { describe, it, expect } from '@jest/globals';
import { parseAlignZones } from '../alignZones';
import { glyphAdvance, parseDefineFontTag, type DefineFont } from '../defineFontTag';
import { decodeGlyphShape, shapeBounds } from '../glyphShape';
import { languageGlyphs } from '../glyphRecipes';
import { readDefineFonts, supplyFontGlyphs } from '../swfGlyphSupply';
import { parseSwf } from '../swfTags';
import { buildSwf } from './swfFixtures';
import {
  alignZonesTag,
  asGfx,
  CAP_HEIGHT,
  donorLibrary,
  fontTag,
  latinGlyphs,
  X_HEIGHT,
} from './glyphFixtures';

const UK = languageGlyphs('uk')!;

const fontsOf = (library: Buffer): DefineFont[] => readDefineFonts(library);

const glyph = (font: DefineFont, char: string) => {
  const index = font.codePoints.indexOf(char.codePointAt(0)!);
  if (index === -1) throw new Error(`${font.name} has no ${char}`);
  return {
    bytes: font.shapes[index]!,
    box: shapeBounds(decodeGlyphShape(font.shapes[index]!)),
    advance: glyphAdvance(font, index)!,
  };
};

const donors = fontsOf(donorLibrary());

describe('supplyFontGlyphs', () => {
  const target = buildSwf([fontTag(1, 'Target Sans', latinGlyphs())]);

  it('gives a same-design font every Ukrainian letter and the punctuation', () => {
    const { buffer, reports, addedCount } = supplyFontGlyphs(target, donors, 'uk');
    const [font] = fontsOf(buffer);

    expect(reports).toEqual([
      expect.objectContaining({ font: 'Target Sans', donor: 'JP Sans', missing: [] }),
    ]);
    expect(addedCount).toBe(reports[0]!.added.length);
    for (const char of `${UK.letters}ʼ–—…№`)
      expect(font!.codePoints).toContain(char.codePointAt(0));
    // The code table stays sorted, as the format requires.
    expect([...font!.codePoints].sort((a, b) => a - b)).toEqual(font!.codePoints);
  });

  it('takes Latin twins from the font itself, byte for byte', () => {
    const [font] = fontsOf(supplyFontGlyphs(target, donors, 'uk').buffer);

    expect(glyph(font!, 'Н').bytes).toEqual(glyph(font!, 'H').bytes);
    expect(glyph(font!, 'і').bytes).toEqual(glyph(font!, 'i').bytes);
    expect(glyph(font!, 'Ї').bytes).toEqual(glyph(font!, 'Ï').bytes);
    expect(glyph(font!, 'ʼ').bytes).toEqual(glyph(font!, '’').bytes);
  });

  it('fits borrowed letters to the cap height, stem and baseline of the font', () => {
    const [font] = fontsOf(supplyFontGlyphs(target, donors, 'uk').buffer);
    const stemH = glyph(font!, 'H').box;
    const be = glyph(font!, 'Б').box;
    const lowerBe = glyph(font!, 'б').box;

    // A box's stem is its width, and the donor's «Б» is as wide as its «Н», the
    // reference letter, so it must come out exactly as wide as «H».
    expect(be.yMin).toBeCloseTo(-CAP_HEIGHT, -1);
    expect(be.yMax).toBeCloseTo(0, -1);
    expect(be.xMax - be.xMin).toBeCloseTo(stemH.xMax - stemH.xMin, -1);
    expect(lowerBe.yMin).toBeCloseTo(-X_HEIGHT, -1);
    expect(lowerBe.yMax).toBeCloseTo(0, -1);
  });

  it('spaces a borrowed letter like the Latin letters it names', () => {
    const [font] = fontsOf(supplyFontGlyphs(target, donors, 'uk').buffer);
    const be = glyph(font!, 'Б');
    const e = glyph(font!, 'E');
    const b = glyph(font!, 'B');

    expect(be.box.xMin).toBe(e.box.xMin);
    expect(be.advance - be.box.xMax).toBe(b.advance - b.box.xMax);
  });

  it('builds «Ґ» from the added «Г» with an upturn that stays on top of the bar', () => {
    const [font] = fontsOf(supplyFontGlyphs(target, donors, 'uk').buffer);
    const gheBox = glyph(font!, 'Г').box;
    const upturned = glyph(font!, 'Ґ').box;

    expect(upturned.yMin).toBeLessThan(gheBox.yMin);
    expect(upturned.yMax).toBe(gheBox.yMax);
    expect(upturned.xMax).toBeLessThanOrEqual(gheBox.xMax);
  });

  it('draws lowercase with the capitals in a unicase font', () => {
    const unicase = buildSwf([fontTag(1, 'Caps Mono', latinGlyphs(1, true))]);
    const [font] = fontsOf(supplyFontGlyphs(unicase, donors, 'uk').buffer);

    expect(glyph(font!, 'ж').bytes).toEqual(glyph(font!, 'Ж').bytes);
    expect(glyph(font!, 'ґ').bytes).toEqual(glyph(font!, 'Ґ').bytes);
  });

  it('leaves a font with no same-design donor exactly as it was', () => {
    const library = buildSwf([fontTag(1, 'Wide Display', latinGlyphs(4))]);
    const { buffer, reports, addedCount } = supplyFontGlyphs(library, donors, 'uk');

    expect(addedCount).toBe(0);
    expect(buffer).toBe(library);
    expect(reports[0]!.donor).toBeUndefined();
    expect(reports[0]!.missing).toEqual(expect.arrayContaining(['Б', 'ж', 'ґ']));
    expect(reports[0]!.added).toEqual([]);
  });

  it('keeps one align-zone record per glyph', () => {
    const count = Object.keys(latinGlyphs()).length;
    const library = buildSwf([fontTag(1, 'Target Sans', latinGlyphs()), alignZonesTag(1, count)]);
    const swf = parseSwf(supplyFontGlyphs(library, donors, 'uk').buffer);
    const font = parseDefineFontTag(swf.tags.find((t) => t.code === 75)!.body)!;
    const zones = parseAlignZones(swf.tags.find((t) => t.code === 73)!.body)!;

    expect(zones.records).toHaveLength(font.shapes.length);
    // The new «Н» shares the zones of «H», the glyph it was copied from.
    expect(zones.records[font.codePoints.indexOf(0x041d)]).toEqual(
      zones.records[font.codePoints.indexOf(0x48)],
    );
  });

  it('writes a Scaleform library back as one', () => {
    const { buffer } = supplyFontGlyphs(asGfx(target), donors, 'uk');

    expect(buffer.toString('ascii', 0, 3)).toBe('GFX');
    expect(fontsOf(buffer)[0]!.codePoints).toContain('Ж'.codePointAt(0));
  });

  it('changes nothing for a language without known letters', () => {
    const result = supplyFontGlyphs(target, donors, 'xx');

    expect(result.buffer).toBe(target);
    expect(result.reports).toEqual([]);
  });

  it('reports a font that already draws the language without touching it', () => {
    const supplied = supplyFontGlyphs(target, donors, 'uk').buffer;
    const again = supplyFontGlyphs(supplied, donors, 'uk');

    expect(again.addedCount).toBe(0);
    expect(again.buffer).toBe(supplied);
  });
});

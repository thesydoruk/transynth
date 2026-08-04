import { describe, it, expect } from '@jest/globals';
import { glyphAdvance, parseDefineFontTag } from '../defineFontTag';
import {
  glyphOpsForLanguage,
  patchFontGlyphs,
  UKRAINIAN_GLYPH_OPS,
  type GlyphOp,
} from '../swfFontPatch';
import { parseSwf } from '../swfTags';
import {
  BOXED_CODE_POINTS,
  BOX_OUTLINE,
  buildSwf,
  defineFont3,
  GHE_UPTURN,
  IE,
  LATIN_I,
  LATIN_I_DIAERESIS,
  placeholderFontLibrary,
  REAL_OUTLINES,
  SAMPLE_CODE_POINTS,
  tag,
  UKRAINIAN_I,
  YI,
} from './swfFixtures';

const fontOf = (swf: Buffer, index = 0) => {
  const tags = parseSwf(swf).tags.filter((t) => t.code === 75);
  return parseDefineFontTag(tags[index]!.body)!;
};

const shapeOf = (swf: Buffer, codePoint: number, fontIndex = 0): Buffer => {
  const font = fontOf(swf, fontIndex);
  return font.shapes[font.codePoints.indexOf(codePoint)]!;
};

describe('patchFontGlyphs', () => {
  it('rebuilds every Ukrainian letter a Russian-only font draws as a box', () => {
    const { buffer, appliedCount } = patchFontGlyphs(placeholderFontLibrary(), UKRAINIAN_GLYPH_OPS);

    // The capitals have no donor in this font, so only the lowercase set applies.
    expect(appliedCount).toBe(4); // і, ї copied; є, ґ derived
    expect(shapeOf(buffer, UKRAINIAN_I)).toEqual(REAL_OUTLINES[LATIN_I]);
    expect(shapeOf(buffer, YI)).toEqual(REAL_OUTLINES[LATIN_I_DIAERESIS]);
    expect(shapeOf(buffer, IE)).not.toEqual(BOX_OUTLINE);
    expect(shapeOf(buffer, GHE_UPTURN)).not.toEqual(BOX_OUTLINE);
  });

  it('gives repaired glyphs the advance of the letter they came from', () => {
    const { buffer } = patchFontGlyphs(placeholderFontLibrary(), UKRAINIAN_GLYPH_OPS);
    const font = fontOf(buffer);

    for (const codePoint of [UKRAINIAN_I, YI, IE, GHE_UPTURN]) {
      expect(glyphAdvance(font, font.codePoints.indexOf(codePoint))).toBe(1100);
    }
  });

  it('leaves letters the font already draws properly alone', () => {
    const already = buildSwf([
      tag(
        75,
        defineFont3(1, 'Roboto Condensed', [LATIN_I, UKRAINIAN_I, ...BOXED_CODE_POINTS.slice(1)], {
          shapeFor: (cp) => (cp === UKRAINIAN_I ? Buffer.from([0x10, 0x42, 0x42]) : BOX_OUTLINE),
        }),
      ),
    ]);

    const { results, appliedCount } = patchFontGlyphs(already, [
      { kind: 'copy', from: 'i', to: 'і' },
    ]);

    expect(appliedCount).toBe(0);
    expect(results[0]!.reason).toBe('already-drawn');
  });

  it('reports letters it cannot build', () => {
    const noCyrillic = buildSwf([tag(75, defineFont3(1, 'Brody', [LATIN_I, 0x0041]))]);

    const { results } = patchFontGlyphs(noCyrillic, [
      { kind: 'copy', from: 'i', to: 'і' },
      { kind: 'mirror', from: 'э', to: 'є' },
    ]);

    expect(results.map((r) => r.reason)).toEqual(['target-missing', 'source-missing']);
  });

  it('patches only the named fonts', () => {
    const twoFonts = placeholderFontLibrary('Share-TechMono Regular', [
      tag(
        75,
        defineFont3(2, 'Handwritten_Institute', SAMPLE_CODE_POINTS, {
          shapeFor: (cp) => REAL_OUTLINES[cp] ?? BOX_OUTLINE,
        }),
      ),
    ]);

    const { buffer, results } = patchFontGlyphs(twoFonts, UKRAINIAN_GLYPH_OPS, [
      'share-techmono regular',
    ]);

    expect(new Set(results.map((r) => r.font))).toEqual(new Set(['Share-TechMono Regular']));
    expect(shapeOf(buffer, UKRAINIAN_I, 1)).toEqual(BOX_OUTLINE);
  });

  it('leaves untouched fonts and the container byte for byte identical', () => {
    const original = placeholderFontLibrary('Share-TechMono Regular', [
      tag(9, Buffer.from([1, 2, 3])),
    ]);

    const { buffer } = patchFontGlyphs(original, UKRAINIAN_GLYPH_OPS);
    const before = parseSwf(original);
    const after = parseSwf(buffer);

    expect(after.tags.map((t) => t.code)).toEqual(before.tags.map((t) => t.code));
    expect(after.tags[1]!.body).toEqual(before.tags[1]!.body);
    expect(after.preamble).toEqual(before.preamble);
  });

  it('is a no-op when there is nothing broken to fix', () => {
    const ops: GlyphOp[] = [{ kind: 'copy', from: 'i', to: 'i' }];

    const { appliedCount, buffer } = patchFontGlyphs(placeholderFontLibrary(), ops);

    expect(appliedCount).toBe(0);
    expect(shapeOf(buffer, LATIN_I)).toEqual(REAL_OUTLINES[LATIN_I]);
  });
});

describe('glyphOpsForLanguage', () => {
  it('knows the Ukrainian repairs, region tag or not', () => {
    expect(glyphOpsForLanguage('uk')).toEqual(UKRAINIAN_GLYPH_OPS);
    expect(glyphOpsForLanguage('UK-ua')).toEqual(UKRAINIAN_GLYPH_OPS);
  });

  it('has nothing to offer for other languages', () => {
    expect(glyphOpsForLanguage('ru')).toEqual([]);
    expect(glyphOpsForLanguage('')).toEqual([]);
  });
});

import { describe, it, expect } from '@jest/globals';
import { glyphAdvance, parseDefineFontTag } from '../defineFontTag';
import { encodeGlyphShape, type GlyphShape } from '../glyphShape';
import { patchFontGlyphs, UKRAINIAN_GLYPH_OPS, type GlyphOp } from '../swfFontPatch';
import { parseSwf } from '../swfTags';
import { buildSwf, defineFont3, tag } from './swfFixtures';

const LATIN_I = 0x0069;
const LATIN_I_DIAERESIS = 0x00ef;
const UKRAINIAN_I = 0x0456;
const YI = 0x0457;
const IE = 0x0454;
const GHE = 0x0433;
const GHE_UPTURN = 0x0491;
const RUSSIAN_E = 0x044d;

/** Enough code points sharing the box that it reads as a placeholder. */
const BOXED = [UKRAINIAN_I, YI, IE, GHE_UPTURN, 0x2020, 0x0402];
const BOX = encodeGlyphShape({
  fillBits: 1,
  lineBits: 0,
  records: [
    { kind: 'style', move: { x: 0, y: -900 }, fill1: 1 },
    { kind: 'line', dx: 500, dy: 0 },
    { kind: 'line', dx: 0, dy: 900 },
    { kind: 'line', dx: -500, dy: 0 },
  ],
});

const outline = (records: GlyphShape['records']): Buffer =>
  encodeGlyphShape({ fillBits: 1, lineBits: 0, records });

const LETTER: Record<number, Buffer> = {
  [LATIN_I]: outline([
    { kind: 'style', move: { x: 100, y: -700 }, fill1: 1 },
    { kind: 'line', dx: 200, dy: 0 },
    { kind: 'line', dx: 0, dy: 700 },
    { kind: 'line', dx: -200, dy: 0 },
  ]),
  [LATIN_I_DIAERESIS]: outline([
    { kind: 'style', move: { x: 100, y: -900 }, fill1: 1 },
    { kind: 'line', dx: 200, dy: 0 },
    { kind: 'line', dx: 0, dy: 900 },
    { kind: 'line', dx: -200, dy: 0 },
  ]),
  [RUSSIAN_E]: outline([
    { kind: 'style', move: { x: 100, y: -700 }, fill1: 1 },
    { kind: 'line', dx: 500, dy: 0 },
    { kind: 'curve', cdx: 200, cdy: 350, adx: -200, ady: 350 },
    { kind: 'line', dx: -500, dy: 0 },
  ]),
  [GHE]: outline([
    { kind: 'style', move: { x: 0, y: -1000 }, fill1: 1 },
    { kind: 'line', dx: 600, dy: 0 },
    { kind: 'line', dx: 0, dy: 150 },
    { kind: 'line', dx: -450, dy: 0 },
    { kind: 'line', dx: 0, dy: 850 },
    { kind: 'line', dx: -150, dy: 0 },
  ]),
};

const CODE_POINTS = [LATIN_I, LATIN_I_DIAERESIS, RUSSIAN_E, GHE, ...BOXED];

/** A terminal-font stand-in: real Latin and Russian letters, boxes for Ukrainian. */
const library = (name = 'Share-TechMono Regular', extraTags: Buffer[] = []): Buffer =>
  buildSwf([
    tag(
      75,
      defineFont3(1, name, CODE_POINTS, {
        shapeFor: (cp) => LETTER[cp] ?? BOX,
        // The boxes of the capital range carry a half-width advance.
        advances: CODE_POINTS.map((cp) => (BOXED.includes(cp) ? 512 : 1100)),
        ascent: 1750,
      }),
    ),
    ...extraTags,
  ]);

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
    const { buffer, appliedCount } = patchFontGlyphs(library(), UKRAINIAN_GLYPH_OPS);

    // The capitals have no donor in this font, so only the lowercase set applies.
    expect(appliedCount).toBe(4); // і, ї copied; є, ґ derived
    expect(shapeOf(buffer, UKRAINIAN_I)).toEqual(LETTER[LATIN_I]);
    expect(shapeOf(buffer, YI)).toEqual(LETTER[LATIN_I_DIAERESIS]);
    expect(shapeOf(buffer, IE)).not.toEqual(BOX);
    expect(shapeOf(buffer, GHE_UPTURN)).not.toEqual(BOX);
  });

  it('gives repaired glyphs the advance of the letter they came from', () => {
    const { buffer } = patchFontGlyphs(library(), UKRAINIAN_GLYPH_OPS);
    const font = fontOf(buffer);

    for (const codePoint of [UKRAINIAN_I, YI, IE, GHE_UPTURN]) {
      expect(glyphAdvance(font, font.codePoints.indexOf(codePoint))).toBe(1100);
    }
  });

  it('leaves letters the font already draws properly alone', () => {
    const already = buildSwf([
      tag(
        75,
        defineFont3(1, 'Roboto Condensed', [LATIN_I, UKRAINIAN_I, ...BOXED.slice(1)], {
          shapeFor: (cp) => (cp === UKRAINIAN_I ? Buffer.from([0x10, 0x42, 0x42]) : BOX),
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
    const twoFonts = library('Share-TechMono Regular', [
      tag(
        75,
        defineFont3(2, 'Handwritten_Institute', CODE_POINTS, {
          shapeFor: (cp) => LETTER[cp] ?? BOX,
        }),
      ),
    ]);

    const { buffer, results } = patchFontGlyphs(twoFonts, UKRAINIAN_GLYPH_OPS, [
      'share-techmono regular',
    ]);

    expect(new Set(results.map((r) => r.font))).toEqual(new Set(['Share-TechMono Regular']));
    expect(shapeOf(buffer, UKRAINIAN_I, 1)).toEqual(BOX);
  });

  it('leaves untouched fonts and the container byte for byte identical', () => {
    const original = library('Share-TechMono Regular', [tag(9, Buffer.from([1, 2, 3]))]);

    const { buffer } = patchFontGlyphs(original, UKRAINIAN_GLYPH_OPS);
    const before = parseSwf(original);
    const after = parseSwf(buffer);

    expect(after.tags.map((t) => t.code)).toEqual(before.tags.map((t) => t.code));
    expect(after.tags[1]!.body).toEqual(before.tags[1]!.body);
    expect(after.preamble).toEqual(before.preamble);
  });

  it('is a no-op when there is nothing broken to fix', () => {
    const ops: GlyphOp[] = [{ kind: 'copy', from: 'i', to: 'i' }];

    const { appliedCount, buffer } = patchFontGlyphs(library(), ops);

    expect(appliedCount).toBe(0);
    expect(shapeOf(buffer, LATIN_I)).toEqual(LETTER[LATIN_I]);
  });
});

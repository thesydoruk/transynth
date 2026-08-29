import { describe, it, expect } from '@jest/globals';
import {
  fontAscent,
  glyphAdvance,
  parseDefineFontTag,
  setGlyphAdvance,
  writeDefineFontTag,
} from '../defineFontTag';
import { defineFont3 } from './swfFixtures';

const CYRILLIC_I = 0x0456;

describe('parseDefineFontTag', () => {
  it('decodes the name, code table and one shape per glyph', () => {
    const body = defineFont3(3, 'Share-TechMono Regular', [0x0069, CYRILLIC_I], {
      shapeFor: (_, index) => Buffer.from([0x10, index, index]),
    });

    const font = parseDefineFontTag(body)!;

    expect(font.fontId).toBe(3);
    expect(font.name).toBe('Share-TechMono Regular');
    expect(font.codePoints).toEqual([0x0069, CYRILLIC_I]);
    expect(font.shapes.map((s) => [...s])).toEqual([
      [0x10, 0, 0],
      [0x10, 1, 1],
    ]);
  });

  it('strips the NUL padding Bethesda writes after a font name', () => {
    const font = parseDefineFontTag(defineFont3(1, 'Brody\0', [0x0041]))!;

    expect(font.name).toBe('Brody');
    expect(font.nameRaw.length).toBe(6);
  });

  it('returns null for a truncated body', () => {
    const body = defineFont3(1, 'Cut', [0x0041, 0x0042]);

    expect(parseDefineFontTag(body.subarray(0, 8))).toBeNull();
    expect(parseDefineFontTag(Buffer.alloc(3))).toBeNull();
  });
});

describe('writeDefineFontTag', () => {
  it('re-encodes an untouched font byte for byte', () => {
    const body = defineFont3(9, 'Roboto Condensed', [0x0041, 0x0438, CYRILLIC_I], {
      advances: [500, 600, 700],
    });

    expect(writeDefineFontTag(parseDefineFontTag(body)!)).toEqual(body);
  });

  it('keeps every glyph readable after a shape grows past 16-bit offsets', () => {
    const body = defineFont3(1, 'Big', [0x0041, 0x0042]);
    const font = parseDefineFontTag(body)!;
    font.shapes[0] = Buffer.alloc(70000, 0x11);

    const reparsed = parseDefineFontTag(writeDefineFontTag(font))!;

    expect(reparsed.shapes[0]!.length).toBe(70000);
    expect(reparsed.shapes[1]).toEqual(font.shapes[1]);
    expect(reparsed.codePoints).toEqual([0x0041, 0x0042]);
  });
});

describe('glyph metrics', () => {
  const withLayout = () =>
    parseDefineFontTag(
      defineFont3(1, 'Share-TechMono Regular', [0x0049, 0x0406], {
        advances: [11059, 5120],
        ascent: 17510,
      }),
    )!;

  it('reads the ascent and per-glyph advances', () => {
    const font = withLayout();

    expect(fontAscent(font)).toBe(17510);
    expect(glyphAdvance(font, 0)).toBe(11059);
    expect(glyphAdvance(font, 1)).toBe(5120);
  });

  it('gives a repaired glyph the advance of the letter it came from', () => {
    const font = withLayout();

    expect(setGlyphAdvance(font, 1, glyphAdvance(font, 0)!)).toBe(true);

    expect(glyphAdvance(parseDefineFontTag(writeDefineFontTag(font))!, 1)).toBe(11059);
  });

  it('reports no metrics for a font without a layout section', () => {
    const font = parseDefineFontTag(defineFont3(1, 'No Layout', [0x0041]))!;

    expect(fontAscent(font)).toBeNull();
    expect(glyphAdvance(font, 0)).toBeNull();
    expect(setGlyphAdvance(font, 0, 500)).toBe(false);
  });
});

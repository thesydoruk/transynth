import { describe, it, expect } from '@jest/globals';
import { parseAlignZones, writeAlignZones } from '../alignZones';
import { glyphAdvance, parseDefineFontTag, writeDefineFontTag } from '../defineFontTag';
import { encodeRect, insertGlyph, parseFontLayout } from '../fontLayout';
import { parseSwf, writeSwf } from '../swfTags';
import { buildSwf, defineFont3 } from './swfFixtures';
import { alignZonesTag, asGfx, box } from './glyphFixtures';

const font = () =>
  parseDefineFontTag(
    defineFont3(7, 'Sample', [0x41, 0x43, 0x44f], {
      shapeFor: (_, i) => box(0, 100 + i, -700),
      advances: [500, 600, 700],
    }),
  )!;

describe('insertGlyph', () => {
  it('slots the glyph into the sorted code table with its advance and bounds', () => {
    const f = font();
    const index = insertGlyph(f, {
      codePoint: 0x42,
      shape: box(0, 50, -700),
      advance: 550,
      bounds: { xMin: 0, xMax: 50, yMin: -700, yMax: 0 },
    });

    expect(index).toBe(1);
    expect(f.codePoints).toEqual([0x41, 0x42, 0x43, 0x44f]);
    expect([0, 1, 2, 3].map((i) => glyphAdvance(f, i))).toEqual([500, 550, 600, 700]);
    expect(parseFontLayout(f)!.bounds).toHaveLength(4);
  });

  it('re-encodes to a tag the parser reads back the same', () => {
    const f = font();
    insertGlyph(f, {
      codePoint: 0x430,
      shape: box(0, 60, -500),
      advance: 480,
      bounds: { xMin: 0, xMax: 60, yMin: -500, yMax: 0 },
    });
    const again = parseDefineFontTag(writeDefineFontTag(f))!;

    expect(again.codePoints).toEqual(f.codePoints);
    expect(again.shapes).toEqual(f.shapes);
    expect(again.layout).toEqual(f.layout);
  });

  it('widens the code table and the kerning pairs of a narrow-code font', () => {
    const f = font();
    f.flags &= ~0x04;
    f.codePoints = [0x41, 0x43, 0x44];
    // One kerning pair A–C of -30, narrow codes.
    const layout = parseFontLayout(f)!;
    f.layout = Buffer.concat([
      f.layout.subarray(0, f.layout.length - 2),
      Buffer.from([1, 0, 0x41, 0x43, 0xe2, 0xff]),
    ]);
    expect(layout.kerning).toEqual(Buffer.from([0, 0]));

    insertGlyph(f, {
      codePoint: 0x416,
      shape: box(0, 80, -700),
      advance: 800,
      bounds: { xMin: 0, xMax: 80, yMin: -700, yMax: 0 },
    });

    expect(f.flags & 0x04).toBe(0x04);
    expect(parseFontLayout(f)!.kerning).toEqual(Buffer.from([1, 0, 0x41, 0, 0x43, 0, 0xe2, 0xff]));
  });

  it('refuses a code point the font already has', () => {
    expect(() =>
      insertGlyph(font(), {
        codePoint: 0x41,
        shape: box(0, 1, -1),
        advance: 1,
        bounds: { xMin: 0, xMax: 1, yMin: -1, yMax: 0 },
      }),
    ).toThrow(/already has/);
  });
});

describe('encodeRect', () => {
  it('stores an empty box in the narrowest form', () => {
    expect(encodeRect({ xMin: 0, xMax: 0, yMin: 0, yMax: 0 })).toEqual(Buffer.from([0x08, 0x00]));
  });
});

describe('align zones', () => {
  it('round-trips the table byte for byte', () => {
    const body = parseSwf(buildSwf([alignZonesTag(3, 4)])).tags[0]!.body;
    const zones = parseAlignZones(body)!;

    expect(zones.fontId).toBe(3);
    expect(zones.records).toHaveLength(4);
    expect(writeAlignZones(zones)).toEqual(body);
  });
});

describe('Scaleform containers', () => {
  it('reads a GFX library and writes it back under the same signature', () => {
    const gfx = asGfx(buildSwf([alignZonesTag(1, 1)]));
    const swf = parseSwf(gfx);

    expect(swf.gfx).toBe(true);
    expect(writeSwf(swf)).toEqual(gfx);
  });

  it('keeps writing plain SWF files without the flag', () => {
    const swf = parseSwf(buildSwf([alignZonesTag(1, 1)], true));

    expect(swf.gfx).toBeUndefined();
    expect(writeSwf(swf).toString('ascii', 0, 3)).toBe('CWS');
  });
});

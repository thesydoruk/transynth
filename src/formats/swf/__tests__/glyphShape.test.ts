import { describe, it, expect } from '@jest/globals';
import { BitReader, BitWriter, signedBitWidth } from '../bitIo';
import { decodeGlyphShape, encodeGlyphShape, shapeBounds, type GlyphShape } from '../glyphShape';

describe('bit IO', () => {
  it('reads bit fields most significant bit first', () => {
    const reader = new BitReader(Buffer.from([0b1011_0010, 0b0100_0000]));

    expect(reader.ub(4)).toBe(0b1011);
    expect(reader.ub(4)).toBe(0b0010);
    expect(reader.ub(2)).toBe(0b01);
  });

  it('sign-extends signed fields', () => {
    const reader = new BitReader(Buffer.from([0b1111_0001]));

    expect(reader.sb(4)).toBe(-1);
    expect(reader.sb(4)).toBe(1);
  });

  it('writes what it reads back', () => {
    const writer = new BitWriter();
    writer.ub(3, 5);
    writer.sb(6, -20);
    writer.align();

    const reader = new BitReader(writer.toBuffer());

    expect(writer.toBuffer().length).toBe(2);
    expect(reader.ub(3)).toBe(5);
    expect(reader.sb(6)).toBe(-20);
  });

  it('sizes signed fields to the widest value', () => {
    expect(signedBitWidth([0])).toBe(1);
    expect(signedBitWidth([1])).toBe(2);
    expect(signedBitWidth([-2, 1])).toBe(2);
    expect(signedBitWidth([2])).toBe(3);
    expect(signedBitWidth([-2048, 300])).toBe(12);
  });
});

describe('decodeGlyphShape', () => {
  it('decodes a hand-assembled move and horizontal line', () => {
    // fill/line bits, then: style record moving to (2, -2) with fill style 1,
    // a horizontal line of +1, and the end record.
    const shape = decodeGlyphShape(Buffer.from([0x11, 0x14, 0xa2, 0xf7, 0x01, 0x00]));

    expect(shape.fillBits).toBe(1);
    expect(shape.lineBits).toBe(1);
    expect(shape.records).toEqual([
      { kind: 'style', move: { x: 2, y: -2 }, fill1: 1 },
      { kind: 'line', dx: 1, dy: 0 },
    ]);
  });

  it('refuses records that redefine styles, which font glyphs never do', () => {
    // No fill/line bits, then a non-edge record whose first state flag is StateNewStyles.
    expect(() => decodeGlyphShape(Buffer.from([0x00, 0b0_10000_00]))).toThrow(/StateNewStyles/);
  });
});

describe('encodeGlyphShape', () => {
  const square: GlyphShape = {
    fillBits: 1,
    lineBits: 0,
    records: [
      { kind: 'style', move: { x: 100, y: -700 }, fill1: 1 },
      { kind: 'line', dx: 400, dy: 0 },
      { kind: 'line', dx: 0, dy: 700 },
      { kind: 'curve', cdx: -200, cdy: 40, adx: -200, ady: -40 },
      { kind: 'line', dx: -1, dy: -3 },
    ],
  };

  it('round-trips every record kind', () => {
    expect(decodeGlyphShape(encodeGlyphShape(square)).records).toEqual(square.records);
  });

  it('ends byte-aligned', () => {
    const encoded = encodeGlyphShape(square);

    expect(decodeGlyphShape(encoded).records).toHaveLength(square.records.length);
    expect(Number.isInteger(encoded.length)).toBe(true);
  });

  it('narrows field widths, so a re-encode never grows', () => {
    const wide = Buffer.from([0x11, 0x14, 0xa2, 0xf7, 0x01, 0x00]);

    expect(encodeGlyphShape(decodeGlyphShape(wide)).length).toBeLessThanOrEqual(wide.length);
  });
});

describe('shapeBounds', () => {
  it('covers anchors and curve control points', () => {
    const bounds = shapeBounds({
      fillBits: 1,
      lineBits: 0,
      records: [
        { kind: 'style', move: { x: 10, y: -100 }, fill1: 1 },
        { kind: 'line', dx: 50, dy: 0 },
        { kind: 'curve', cdx: 20, cdy: -30, adx: -20, ady: 130 },
      ],
    });

    expect(bounds).toEqual({ xMin: 10, xMax: 80, yMin: -130, yMax: 0 });
  });

  it('returns a zero box for an empty outline', () => {
    expect(shapeBounds({ fillBits: 1, lineBits: 0, records: [] })).toEqual({
      xMin: 0,
      xMax: 0,
      yMin: 0,
      yMax: 0,
    });
  });
});

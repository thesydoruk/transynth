/**
 * Adding glyphs to a `DefineFont2` / `DefineFont3` font.
 *
 * Replacing an outline keeps every glyph-indexed table valid; adding one does not.
 * The code table must stay sorted, so a new glyph lands in the middle, and the
 * layout section — ascent, descent, leading, then one advance and one bounds `RECT`
 * per glyph, then the kerning pairs — has to grow at the same index. Kerning pairs
 * name code points, not indexes, so they survive untouched.
 */
import { BitReader, BitWriter, signedBitWidth } from './bitIo';
import type { DefineFont } from './defineFontTag';
import type { ShapeBounds } from './glyphShape';

const FLAG_WIDE_CODES = 0x04;
const FLAG_HAS_LAYOUT = 0x80;

export type FontLayout = {
  /** Ascent, descent and leading, verbatim. */
  head: Buffer;
  advances: number[];
  /** Bounds `RECT` per glyph, as stored (Flash and Scaleform write them empty). */
  bounds: Buffer[];
  /** Kerning count and pairs, verbatim. */
  kerning: Buffer;
};

/** Byte length of the `RECT` at the start of `buf`. */
const rectSize = (buf: Buffer): number => Math.ceil((5 + 4 * (buf[0]! >> 3)) / 8);

/** Encode a `RECT` holding the given box. */
export const encodeRect = (box: ShapeBounds): Buffer => {
  const values = [box.xMin, box.xMax, box.yMin, box.yMax];
  const bits = values.every((v) => v === 0) ? 1 : signedBitWidth(values);
  const writer = new BitWriter();
  writer.ub(5, bits);
  for (const value of values) writer.sb(bits, value);
  writer.align();
  return writer.toBuffer();
};

const isEmptyRect = (rect: Buffer): boolean => {
  const reader = new BitReader(rect);
  const bits = reader.ub(5);
  return [0, 1, 2, 3].every(() => reader.sb(bits) === 0);
};

/**
 * Split a font's layout section into its tables.
 *
 * @returns The tables, or `null` when the font has no layout or it is truncated.
 */
export const parseFontLayout = (font: DefineFont): FontLayout | null => {
  if ((font.flags & FLAG_HAS_LAYOUT) === 0) return null;
  const count = font.shapes.length;
  const layout = font.layout;
  if (layout.length < 6 + count * 2) return null;

  const advances: number[] = [];
  for (let i = 0; i < count; i++) advances.push(layout.readInt16LE(6 + i * 2));

  const bounds: Buffer[] = [];
  let pos = 6 + count * 2;
  for (let i = 0; i < count; i++) {
    if (pos >= layout.length) return null;
    const size = rectSize(layout.subarray(pos));
    bounds.push(Buffer.from(layout.subarray(pos, pos + size)));
    pos += size;
  }

  return {
    head: Buffer.from(layout.subarray(0, 6)),
    advances,
    bounds,
    kerning: Buffer.from(layout.subarray(pos)),
  };
};

/** Encode a layout section back into bytes. */
export const writeFontLayout = (layout: FontLayout): Buffer => {
  const advances = Buffer.alloc(layout.advances.length * 2);
  layout.advances.forEach((advance, i) => advances.writeInt16LE(advance, i * 2));
  return Buffer.concat([layout.head, advances, ...layout.bounds, layout.kerning]);
};

/** Kerning pairs name code points in the code table's width, so widening the codes widens them. */
const widenKerning = (kerning: Buffer): Buffer => {
  if (kerning.length < 2) return kerning;
  const count = kerning.readUInt16LE(0);
  const out = Buffer.alloc(2 + count * 6);
  out.writeUInt16LE(count, 0);
  for (let i = 0; i < count; i++) {
    const at = 2 + i * 4;
    out.writeUInt16LE(kerning[at]!, 2 + i * 6);
    out.writeUInt16LE(kerning[at + 1]!, 4 + i * 6);
    out.writeInt16LE(kerning.readInt16LE(at + 2), 6 + i * 6);
  }
  return out;
};

export type NewGlyph = {
  codePoint: number;
  shape: Buffer;
  advance: number;
  bounds: ShapeBounds;
};

/**
 * Add a glyph for a code point the font does not have yet.
 *
 * The glyph goes where the sorted code table wants it. Fonts whose bounds table is
 * all empty rectangles — everything Flash and Scaleform export — get another empty
 * one rather than the only real box in the table.
 *
 * @param font - Font to extend in place.
 * @param glyph - Outline and metrics of the new glyph.
 * @returns Index of the new glyph.
 * @throws When the font already has the code point.
 */
export const insertGlyph = (font: DefineFont, glyph: NewGlyph): number => {
  if (font.codePoints.includes(glyph.codePoint)) {
    throw new Error(`Font ${font.name} already has U+${glyph.codePoint.toString(16)}`);
  }
  const layout = parseFontLayout(font);
  const at = font.codePoints.findIndex((cp) => cp > glyph.codePoint);
  const index = at === -1 ? font.codePoints.length : at;

  font.codePoints.splice(index, 0, glyph.codePoint);
  font.shapes.splice(index, 0, glyph.shape);
  if (glyph.codePoint > 0xff && (font.flags & FLAG_WIDE_CODES) === 0) {
    font.flags |= FLAG_WIDE_CODES;
    if (layout) layout.kerning = widenKerning(layout.kerning);
  }

  if (layout) {
    const emptyTable = layout.bounds.every(isEmptyRect);
    const rect = emptyTable && layout.bounds[0] ? layout.bounds[0] : encodeRect(glyph.bounds);
    layout.advances.splice(index, 0, glyph.advance);
    layout.bounds.splice(index, 0, Buffer.from(rect));
    font.layout = writeFontLayout(layout);
  }
  return index;
};

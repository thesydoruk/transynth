/**
 * Glyph outlines of `DefineFont2`/`DefineFont3`: decode and re-encode.
 *
 * Every glyph is a `SHAPE` record — a fill/line bit width header followed by style
 * change records that move the pen, and edge records that draw straight lines or
 * quadratic curves as deltas from the current point. Coordinates are relative to the
 * baseline at `y = 0`, with y growing downwards, so ascending parts are negative.
 *
 * Decoding to this model and encoding back makes a glyph editable: an outline can be
 * mirrored or extended, which is how «є» and «ґ» are built from letters the font
 * already draws.
 */
import { BitReader, BitWriter, signedBitWidth } from './bitIo';

export type ShapeRecord =
  /** Pen state: an optional move plus the style indices the following edges use. */
  | {
      kind: 'style';
      move?: { x: number; y: number };
      fill0?: number;
      fill1?: number;
      line?: number;
    }
  | { kind: 'line'; dx: number; dy: number }
  | { kind: 'curve'; cdx: number; cdy: number; adx: number; ady: number };

export type GlyphShape = {
  fillBits: number;
  lineBits: number;
  records: ShapeRecord[];
};

export type ShapeBounds = { xMin: number; xMax: number; yMin: number; yMax: number };

/**
 * Decode a glyph shape record.
 *
 * @param buf - Shape bytes of a single glyph.
 * @returns Decoded outline.
 * @throws When the record uses `StateNewStyles`, which font glyphs never do.
 */
export const decodeGlyphShape = (buf: Buffer): GlyphShape => {
  const reader = new BitReader(buf);
  const fillBits = reader.ub(4);
  const lineBits = reader.ub(4);
  const records: ShapeRecord[] = [];

  for (;;) {
    if (reader.ub(1) === 0) {
      const flags = reader.ub(5);
      if (flags === 0) break; // EndShapeRecord
      if (flags & 0x10) throw new Error('StateNewStyles is not supported in glyph shapes');

      const record: ShapeRecord = { kind: 'style' };
      if (flags & 0x01) {
        const moveBits = reader.ub(5);
        record.move = { x: reader.sb(moveBits), y: reader.sb(moveBits) };
      }
      if (flags & 0x02) record.fill0 = reader.ub(fillBits);
      if (flags & 0x04) record.fill1 = reader.ub(fillBits);
      if (flags & 0x08) record.line = reader.ub(lineBits);
      records.push(record);
      continue;
    }

    const straight = reader.ub(1) === 1;
    const bits = reader.ub(4) + 2;
    if (!straight) {
      records.push({
        kind: 'curve',
        cdx: reader.sb(bits),
        cdy: reader.sb(bits),
        adx: reader.sb(bits),
        ady: reader.sb(bits),
      });
      continue;
    }
    if (reader.ub(1) === 1) {
      records.push({ kind: 'line', dx: reader.sb(bits), dy: reader.sb(bits) });
    } else if (reader.ub(1) === 1) {
      records.push({ kind: 'line', dx: 0, dy: reader.sb(bits) });
    } else {
      records.push({ kind: 'line', dx: reader.sb(bits), dy: 0 });
    }
  }

  return { fillBits, lineBits, records };
};

/** Edge delta widths are stored as `bits - 2`, so two bits is the floor. */
const edgeBits = (values: number[]): number => Math.max(2, signedBitWidth(values));

/**
 * Encode a glyph shape record.
 *
 * Field widths are recomputed to the narrowest that fits, so the output is
 * semantically equal to the input but not necessarily byte for byte.
 *
 * @param shape - Outline to encode.
 * @returns Byte-aligned shape record.
 */
export const encodeGlyphShape = (shape: GlyphShape): Buffer => {
  const writer = new BitWriter();
  writer.ub(4, shape.fillBits);
  writer.ub(4, shape.lineBits);

  for (const record of shape.records) {
    if (record.kind === 'style') {
      writer.ub(1, 0);
      writer.ub(1, 0); // StateNewStyles
      writer.ub(1, record.line === undefined ? 0 : 1);
      writer.ub(1, record.fill1 === undefined ? 0 : 1);
      writer.ub(1, record.fill0 === undefined ? 0 : 1);
      writer.ub(1, record.move ? 1 : 0);
      if (record.move) {
        const bits = signedBitWidth([record.move.x, record.move.y]);
        writer.ub(5, bits);
        writer.sb(bits, record.move.x);
        writer.sb(bits, record.move.y);
      }
      if (record.fill0 !== undefined) writer.ub(shape.fillBits, record.fill0);
      if (record.fill1 !== undefined) writer.ub(shape.fillBits, record.fill1);
      if (record.line !== undefined) writer.ub(shape.lineBits, record.line);
      continue;
    }

    writer.ub(1, 1);
    if (record.kind === 'curve') {
      const bits = edgeBits([record.cdx, record.cdy, record.adx, record.ady]);
      writer.ub(1, 0);
      writer.ub(4, bits - 2);
      writer.sb(bits, record.cdx);
      writer.sb(bits, record.cdy);
      writer.sb(bits, record.adx);
      writer.sb(bits, record.ady);
      continue;
    }

    writer.ub(1, 1);
    // A line along an axis stores one delta; only a diagonal needs both.
    if (record.dx !== 0 && record.dy !== 0) {
      const bits = edgeBits([record.dx, record.dy]);
      writer.ub(4, bits - 2);
      writer.ub(1, 1);
      writer.sb(bits, record.dx);
      writer.sb(bits, record.dy);
    } else if (record.dx === 0 && record.dy !== 0) {
      const bits = edgeBits([record.dy]);
      writer.ub(4, bits - 2);
      writer.ub(1, 0);
      writer.ub(1, 1);
      writer.sb(bits, record.dy);
    } else {
      const bits = edgeBits([record.dx]);
      writer.ub(4, bits - 2);
      writer.ub(1, 0);
      writer.ub(1, 0);
      writer.sb(bits, record.dx);
    }
  }

  writer.ub(6, 0); // EndShapeRecord
  writer.align();
  return writer.toBuffer();
};

/** Walk the outline, reporting every pen position including curve control points. */
export const shapePoints = (shape: GlyphShape): { x: number; y: number }[] => {
  const points: { x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  for (const record of shape.records) {
    if (record.kind === 'style') {
      if (!record.move) continue;
      ({ x, y } = record.move);
      points.push({ x, y });
    } else if (record.kind === 'line') {
      x += record.dx;
      y += record.dy;
      points.push({ x, y });
    } else {
      points.push({ x: x + record.cdx, y: y + record.cdy });
      x += record.cdx + record.adx;
      y += record.cdy + record.ady;
      points.push({ x, y });
    }
  }
  return points;
};

/** Bounding box of the outline, or a zero box for an empty shape. */
export const shapeBounds = (shape: GlyphShape): ShapeBounds => {
  const points = shapePoints(shape);
  if (points.length === 0) return { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
  };
};

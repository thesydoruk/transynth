/**
 * Glyph outlines as closed contours of absolute points, for geometric edits.
 *
 * The shape records of a glyph store deltas; scaling or offsetting them one by one
 * accumulates rounding error until a contour no longer closes. Working on absolute
 * points and deriving the deltas again after rounding keeps every contour closed
 * exactly.
 *
 * Each contour keeps the style fields of the record that started it, so the fill
 * sides of the original survive a round trip.
 */
import { shapeBounds, type GlyphShape, type ShapeBounds, type ShapeRecord } from './glyphShape';

export type Point = { x: number; y: number };

/** A segment ends at `to`; a curve bends through `control` on the way. */
export type Segment = { to: Point; control?: Point };

export type Contour = {
  start: Point;
  segments: Segment[];
  style: { fill0?: number; fill1?: number; line?: number };
};

export type GlyphOutline = { fillBits: number; lineBits: number; contours: Contour[] };

/**
 * Split a glyph into contours.
 *
 * @returns The contours, or `null` when a style record changes fills mid-contour,
 *   which glyph shapes do not do and this model cannot express.
 */
export const shapeToOutline = (shape: GlyphShape): GlyphOutline | null => {
  const contours: Contour[] = [];
  let pen: Point = { x: 0, y: 0 };
  let current: Contour | null = null;
  let pendingStyle: Contour['style'] = {};

  for (const record of shape.records) {
    if (record.kind === 'style') {
      const { fill0, fill1, line } = record;
      const style = {
        ...(fill0 !== undefined && { fill0 }),
        ...(fill1 !== undefined && { fill1 }),
        ...(line !== undefined && { line }),
      };
      if (!record.move) {
        if (current && current.segments.length > 0) return null;
        pendingStyle = { ...pendingStyle, ...style };
        continue;
      }
      pen = { ...record.move };
      current = { start: pen, segments: [], style: { ...pendingStyle, ...style } };
      pendingStyle = {};
      contours.push(current);
      continue;
    }
    if (!current) {
      current = { start: pen, segments: [], style: pendingStyle };
      pendingStyle = {};
      contours.push(current);
    }
    if (record.kind === 'line') {
      pen = { x: pen.x + record.dx, y: pen.y + record.dy };
      current.segments.push({ to: pen });
    } else {
      const control = { x: pen.x + record.cdx, y: pen.y + record.cdy };
      pen = { x: control.x + record.adx, y: control.y + record.ady };
      current.segments.push({ to: pen, control });
    }
  }

  return { fillBits: shape.fillBits, lineBits: shape.lineBits, contours };
};

/** Encode contours back into shape records, rounding every point to an integer. */
export const outlineToShape = (outline: GlyphOutline): GlyphShape => {
  const round = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });
  const records: ShapeRecord[] = [];
  for (const contour of outline.contours) {
    let pen = round(contour.start);
    records.push({ kind: 'style', move: pen, ...contour.style });
    for (const segment of contour.segments) {
      const to = round(segment.to);
      if (segment.control) {
        const control = round(segment.control);
        records.push({
          kind: 'curve',
          cdx: control.x - pen.x,
          cdy: control.y - pen.y,
          adx: to.x - control.x,
          ady: to.y - control.y,
        });
      } else if (to.x !== pen.x || to.y !== pen.y) {
        records.push({ kind: 'line', dx: to.x - pen.x, dy: to.y - pen.y });
      }
      pen = to;
    }
  }
  return { fillBits: outline.fillBits, lineBits: outline.lineBits, records };
};

/** Apply a point transform to every point, anchors and control points alike. */
export const mapOutline = (outline: GlyphOutline, fn: (p: Point) => Point): GlyphOutline => ({
  ...outline,
  contours: outline.contours.map((contour) => ({
    ...contour,
    start: fn(contour.start),
    segments: contour.segments.map((s) =>
      s.control ? { to: fn(s.to), control: fn(s.control) } : { to: fn(s.to) },
    ),
  })),
});

/** Every point of a contour in drawing order, control points included, without the closing repeat. */
export const contourPoints = (contour: Contour): Point[] => {
  const points: Point[] = [contour.start];
  for (const segment of contour.segments) {
    if (segment.control) points.push(segment.control);
    points.push(segment.to);
  }
  const last = points[points.length - 1]!;
  if (points.length > 1 && last.x === contour.start.x && last.y === contour.start.y) points.pop();
  return points;
};

/** Bounding box of an outline, control points included, as `shapeBounds` measures it. */
export const outlineBounds = (outline: GlyphOutline): ShapeBounds =>
  shapeBounds(outlineToShape(outline));

/**
 * X positions where a horizontal line crosses the outline, sorted.
 *
 * Curves are flattened into a few chords, which is precise enough to measure a stem.
 */
export const outlineCrossings = (outline: GlyphOutline, y: number): number[] => {
  const xs: number[] = [];
  const cross = (a: Point, b: Point) => {
    if (a.y === b.y) return;
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    if (y < lo || y >= hi) return;
    xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  };
  for (const contour of outline.contours) {
    let pen = contour.start;
    for (const segment of contour.segments) {
      if (!segment.control) {
        cross(pen, segment.to);
      } else {
        let prev = pen;
        for (let i = 1; i <= 8; i++) {
          const t = i / 8;
          const u = 1 - t;
          const next = {
            x: u * u * pen.x + 2 * u * t * segment.control.x + t * t * segment.to.x,
            y: u * u * pen.y + 2 * u * t * segment.control.y + t * t * segment.to.y,
          };
          cross(prev, next);
          prev = next;
        }
      }
      pen = segment.to;
    }
  }
  return xs.sort((a, b) => a - b);
};

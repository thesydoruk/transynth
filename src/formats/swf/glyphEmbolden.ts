/**
 * Make an outline heavier or lighter by moving every contour along its normals.
 *
 * The same approach FreeType uses to synthesise bold from TrueType outlines: each
 * point, control points included, moves away from the ink by `delta` along the mitre
 * of its two neighbouring edges, so straight stems grow by `2 × delta` and curves
 * follow. A negative `delta` thins the strokes. Horizontal and vertical strength can
 * differ, as in FreeType's `FT_Outline_EmboldenXY`: a vertical stem only feels `dx`.
 *
 * Which side is "away from the ink" is decided by nesting, not by winding: a contour
 * inside an odd number of others is a counter. That keeps the result right for fonts
 * exported with either contour direction.
 */
import { contourPoints, type Contour, type GlyphOutline, type Point } from './glyphContours';

/** Longest mitre, in multiples of `delta`, before a sharp corner is clipped. */
const MITER_LIMIT = 3;

const signedArea = (points: Point[]): number => {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
};

const contains = (polygon: Point[], p: Point): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
};

const unit = (dx: number, dy: number): Point | null => {
  const length = Math.hypot(dx, dy);
  return length === 0 ? null : { x: dx / length, y: dy / length };
};

/** Direction from `points[i]` to its nearest distinct neighbour, forwards or backwards. */
const direction = (points: Point[], i: number, step: 1 | -1): Point | null => {
  const here = points[i]!;
  for (let k = 1; k < points.length; k++) {
    const other = points[(i + step * k + points.length * k) % points.length]!;
    const d = unit(other.x - here.x, other.y - here.y);
    if (d) return d;
  }
  return null;
};

/**
 * Offset of every point of one contour.
 *
 * @param side - `1` when the edge normal `(dy, -dx)` points away from the ink, `-1` otherwise.
 */
const contourOffsets = (points: Point[], side: number, dx: number, dy: number): Point[] =>
  points.map((_, i) => {
    const back = direction(points, i, -1);
    const ahead = direction(points, i, 1);
    if (!back || !ahead) return { x: 0, y: 0 };
    // Incoming edge runs from the previous point to this one.
    const tin = { x: -back.x, y: -back.y };
    const nin = { x: side * tin.y, y: -side * tin.x };
    const nout = { x: side * ahead.y, y: -side * ahead.x };
    const cos = nin.x * nout.x + nin.y * nout.y;
    const scale = 1 / Math.max(1 + cos, 2 / (MITER_LIMIT * MITER_LIMIT));
    return { x: (nin.x + nout.x) * scale * dx, y: (nin.y + nout.y) * scale * dy };
  });

/**
 * Embolden (or thin, with a negative `delta`) an outline.
 *
 * @param outline - Outline to change; not modified.
 * @param delta - Distance each edge moves outwards, in font units.
 * @param deltaY - Vertical strength when it differs from the horizontal one.
 * @returns The new outline, unrounded; `outlineToShape` rounds it.
 */
export const emboldenOutline = (
  outline: GlyphOutline,
  delta: number,
  deltaY = delta,
): GlyphOutline => {
  if (delta === 0 && deltaY === 0) return outline;
  const polygons = outline.contours.map(contourPoints);

  const contours = outline.contours.map((contour, index): Contour => {
    const points = polygons[index]!;
    if (points.length < 3) return contour;
    const depth = polygons.filter((other, j) => j !== index && contains(other, points[0]!)).length;
    const side = (signedArea(points) > 0 ? 1 : -1) * (depth % 2 === 0 ? 1 : -1);
    const offsets = contourOffsets(points, side, delta, deltaY);

    // Walk the contour again in the same order contourPoints listed it.
    let cursor = 0;
    const move = (p: Point): Point => {
      const offset = offsets[cursor % offsets.length]!;
      cursor++;
      return { x: p.x + offset.x, y: p.y + offset.y };
    };
    const start = move(contour.start);
    const segments = contour.segments.map((segment) => {
      const control = segment.control ? move(segment.control) : undefined;
      const closing = segment.to.x === contour.start.x && segment.to.y === contour.start.y;
      const to = closing && cursor >= offsets.length ? start : move(segment.to);
      return control ? { to, control } : { to };
    });
    return { ...contour, start, segments };
  });

  return { ...outline, contours };
};

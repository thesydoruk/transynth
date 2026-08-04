/**
 * Build missing Cyrillic letterforms out of glyphs a font already draws.
 *
 * Fonts shipped with Bethesda games carry Russian Cyrillic only, so the Ukrainian
 * letters have to come from somewhere. Two of them are geometric relatives of
 * letters that are present: «Є» is the mirror image of «Э», and «Ґ» is «Г» with an
 * upturn on the right end of its bar. Deriving them inside the same font keeps the
 * weight, width and monospace advance of the original design, which importing from
 * another typeface would not.
 */
import { shapeBounds, shapePoints, type GlyphShape, type ShapeRecord } from './glyphShape';

/**
 * Mirror an outline horizontally within its own bounding box.
 *
 * Deltas are differences of points, so they only flip sign, while an absolute move
 * reflects around the box. Reflecting all contours together leaves the fill rule
 * unchanged, so the letter stays solid.
 *
 * @param shape - Outline to mirror.
 * @returns Mirrored outline occupying the same horizontal space.
 */
export const mirrorGlyphX = (shape: GlyphShape): GlyphShape => {
  const { xMin, xMax } = shapeBounds(shape);
  const axis = xMin + xMax; // reflection about (xMin + xMax) / 2, kept integral
  const records = shape.records.map((record): ShapeRecord => {
    if (record.kind === 'style') {
      return record.move
        ? { ...record, move: { x: axis - record.move.x, y: record.move.y } }
        : record;
    }
    if (record.kind === 'line') return { ...record, dx: -record.dx };
    return { ...record, cdx: -record.cdx, adx: -record.adx };
  });
  return { ...shape, records };
};

/** Signed area of the outline, using anchor points; the sign gives contour winding. */
const windingSign = (shape: GlyphShape): number => {
  const points = shapePoints(shape);
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area < 0 ? -1 : 1;
};

/**
 * Thickness of the stroke at the glyph's right edge.
 *
 * For «Г» the rightmost extent is the free end of the horizontal bar, so the y span
 * of the points there is the bar's thickness — the width the upturn should have.
 */
const rightEdgeThickness = (shape: GlyphShape): number => {
  const { xMax, xMin } = shapeBounds(shape);
  const tolerance = Math.max(1, Math.round((xMax - xMin) * 0.02));
  const ys = shapePoints(shape)
    .filter((p) => p.x >= xMax - tolerance)
    .map((p) => p.y);
  return ys.length < 2 ? 0 : Math.max(...ys) - Math.min(...ys);
};

/** Append a rectangle as a new contour, wound the same way as the outline. */
const appendRect = (
  shape: GlyphShape,
  rect: { x0: number; y0: number; x1: number; y1: number },
): GlyphShape => {
  const { x0, y0, x1, y1 } = rect;
  // Corners in y-down clockwise order give a positive signed area.
  const corners =
    windingSign(shape) > 0
      ? [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ]
      : [
          { x: x0, y: y0 },
          { x: x0, y: y1 },
          { x: x1, y: y1 },
          { x: x1, y: y0 },
        ];

  const records: ShapeRecord[] = [{ kind: 'style', move: corners[0]! }];
  for (let i = 0; i < corners.length; i++) {
    const from = corners[i]!;
    const to = corners[(i + 1) % corners.length]!;
    records.push({ kind: 'line', dx: to.x - from.x, dy: to.y - from.y });
  }
  return { ...shape, records: [...shape.records, ...records] };
};

/** Height of the upturn relative to the letter, matching common Cyrillic designs. */
const UPTURN_HEIGHT_RATIO = 0.3;
/** Fallback stroke width when the right edge cannot be measured. */
const FALLBACK_THICKNESS_RATIO = 0.12;

/**
 * Turn «Г» into «Ґ» by adding an upturn at the right end of its bar.
 *
 * The stroke rises from the bar and overlaps it slightly so the two contours fuse
 * without a seam. Coordinates grow downwards from the baseline, so up is negative.
 *
 * @param shape - Outline of «Г» or «г».
 * @param topLimit - Highest y the outline may reach, normally minus the font ascent;
 *   the upturn is shortened rather than risking a clipped glyph.
 * @returns Outline with the upturn, or `null` when the glyph does not look like «Г».
 */
export const addUpturn = (shape: GlyphShape, topLimit?: number): GlyphShape | null => {
  const { xMax, yMin, yMax } = shapeBounds(shape);
  const height = yMax - yMin;
  if (height <= 0) return null;

  const measured = rightEdgeThickness(shape);
  const thickness =
    measured > 0 && measured < height / 2
      ? measured
      : Math.round(height * FALLBACK_THICKNESS_RATIO);
  const rise = Math.min(
    Math.round(height * UPTURN_HEIGHT_RATIO),
    topLimit === undefined ? Infinity : yMin - topLimit,
  );
  if (thickness <= 0 || rise <= 0) return null;

  return appendRect(shape, {
    x0: xMax - thickness,
    y0: yMin - rise,
    x1: xMax,
    y1: yMin + Math.round(thickness / 3),
  });
};

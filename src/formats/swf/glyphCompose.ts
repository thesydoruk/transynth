/**
 * Glyphs built from other glyphs of the same font.
 *
 * A hand-lettered face may draw a hyphen and a period but no dashes or ellipsis.
 * Stretching its own hyphen and repeating its own period keeps the pen's texture,
 * which a dash from any other font would not. «Ґ» is the font's «Г» with an upturn.
 */
import {
  mapOutline,
  outlineBounds,
  outlineCrossings,
  outlineToShape,
  shapeToOutline,
  type GlyphOutline,
} from './glyphContours';
import type { GlyphShape } from './glyphShape';

/**
 * Stretch a glyph horizontally so its ink is `width` wide, keeping its left edge.
 *
 * @returns The stretched glyph, or `null` for an empty or unsupported outline.
 */
export const stretchGlyphX = (shape: GlyphShape, width: number): GlyphShape | null => {
  const outline = shapeToOutline(shape);
  if (!outline || outline.contours.length === 0) return null;
  const { xMin, xMax } = outlineBounds(outline);
  if (xMax <= xMin) return null;
  const factor = width / (xMax - xMin);
  return outlineToShape(mapOutline(outline, (p) => ({ x: xMin + (p.x - xMin) * factor, y: p.y })));
};

/** Height of the upturn relative to the letter. */
const UPTURN_HEIGHT_RATIO = 0.25;

/** Y positions where a vertical line at `x` crosses the outline, sorted. */
const verticalCrossings = (outline: GlyphOutline, x: number): number[] =>
  outlineCrossings(
    mapOutline(outline, (p) => ({ x: p.y, y: p.x })),
    x,
  );

/**
 * Turn «Г» into «Ґ» with an upturn standing on the flat top of the bar.
 *
 * `addUpturn` sinks its stroke into the bar, which a renderer filling even-odd draws
 * as a notch, and measures the stroke at the bar's very end, which a rounded terminal
 * makes hairline-thin. Here the bar is measured where it is straight: the upturn is
 * as thick as the stem, ends where the bar's top stops being level, and only touches
 * the bar, so it fills the same under either fill rule.
 *
 * @param topLimit - Highest y the outline may reach (minus the font ascent).
 * @returns Outline with the upturn, or `null` when the glyph has no flat-topped bar.
 */
export const addJoinedUpturn = (shape: GlyphShape, topLimit?: number): GlyphShape | null => {
  const outline = shapeToOutline(shape);
  if (!outline || outline.contours.length === 0) return null;
  const { xMin, xMax, yMin, yMax } = outlineBounds(outline);
  const height = yMax - yMin;
  if (height <= 0 || xMax <= xMin) return null;

  // Thickness of the bar two thirds of the way along it, clear of stem and terminal.
  const probe = verticalCrossings(outline, xMin + (xMax - xMin) * 0.66);
  if (probe.length < 2) return null;
  const barTop = probe[0]!;
  const bar = probe[1]! - barTop;
  // The upturn is a vertical stroke, so it takes the stem's weight, not the bar's.
  const stem = outlineCrossings(outline, Math.round((yMin + yMax) / 2));
  const thickness = Math.round(stem.length >= 2 ? stem[1]! - stem[0]! : bar);
  if (barTop - yMin > height * 0.1 || bar <= 0 || thickness <= 0 || thickness > height / 2) {
    return null;
  }

  // Walk right along the bar's top until it bends down into the terminal. A hand-drawn
  // bar may slope, so the test is the local slope, not the height of the probe.
  const tops = new Map<number, number>();
  const step = Math.max(1, Math.round((xMax - xMin) / 200));
  let flatEnd = Math.round(xMin + (xMax - xMin) * 0.66);
  let previous = barTop;
  for (let x = flatEnd; x <= xMax; x += step) {
    const top = verticalCrossings(outline, x)[0];
    if (top === undefined || Math.abs(top - previous) > step) break;
    if (Math.abs(top - barTop) > bar) break;
    tops.set(x, top);
    flatEnd = x;
    previous = top;
  }
  const x0 = flatEnd - thickness;
  if (x0 < xMin) return null;
  // The stroke stands on the bar along the chord between its two feet, so a sloping
  // bar gets a sloping foot instead of a gap.
  const topAt = (x: number): number => {
    const sampled = [...tops].find(([at]) => at >= x);
    return sampled ? sampled[1] : (verticalCrossings(outline, x)[0] ?? barTop);
  };
  const leftFoot = topAt(x0);
  const rightFoot = tops.get(flatEnd) ?? barTop;
  const rise = Math.min(
    Math.round(height * UPTURN_HEIGHT_RATIO),
    topLimit === undefined ? Infinity : Math.min(leftFoot, rightFoot) - topLimit,
  );
  if (rise <= 0) return null;

  const y0 = Math.min(leftFoot, rightFoot) - rise;
  const rect = [
    { x: x0, y: y0 },
    { x: flatEnd, y: y0 },
    { x: flatEnd, y: rightFoot },
    { x: x0, y: leftFoot },
  ];
  const contour = {
    start: rect[0]!,
    segments: [...rect.slice(1), rect[0]!].map((to) => ({ to })),
    style: {},
  };
  return outlineToShape({ ...outline, contours: [...outline.contours, contour] });
};

/**
 * Repeat a glyph side by side, `step` units apart, as one outline.
 *
 * @returns The combined glyph, or `null` for an empty or unsupported outline.
 */
export const repeatGlyph = (shape: GlyphShape, count: number, step: number): GlyphShape | null => {
  const outline = shapeToOutline(shape);
  if (!outline || outline.contours.length === 0) return null;
  const contours = Array.from(
    { length: count },
    (_, i) => mapOutline(outline, (p) => ({ x: p.x + i * step, y: p.y })).contours,
  ).flat();
  return outlineToShape({ ...outline, contours });
};

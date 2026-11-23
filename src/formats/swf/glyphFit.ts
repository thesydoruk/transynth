/**
 * Fit a glyph borrowed from another font to the font that receives it.
 *
 * The game's Japanese font set draws Cyrillic in a CJK face's design: taller than the
 * Latin it sits next to, lighter, and spaced on a full-width grid. Copied as is, it
 * would tower over the Latin letters and leave gaps inside every word. Fitting fixes
 * the three things a reader notices first:
 *
 * - height — scaled so the donor's «Н» (or «х» for lowercase) matches the target's
 *   «H» (or «x»);
 * - weight — emboldened or thinned until the donor's stem matches the target's;
 * - spacing — side bearings copied from Latin letters with the same edge shape.
 */
import { emboldenOutline } from './glyphEmbolden';
import {
  mapOutline,
  outlineBounds,
  outlineCrossings,
  outlineToShape,
  shapeToOutline,
  type GlyphOutline,
} from './glyphContours';
import { decodeGlyphShape, encodeGlyphShape, type ShapeBounds } from './glyphShape';
import { glyphAdvance, type DefineFont } from './defineFontTag';

/** Where a font keeps one of its glyphs; `null` when the font lacks it. */
export const glyphIndex = (font: DefineFont, char: string): number | null => {
  const index = font.codePoints.indexOf(char.codePointAt(0)!);
  return index === -1 ? null : index;
};

export const glyphOutline = (font: DefineFont, char: string): GlyphOutline | null => {
  const index = glyphIndex(font, char);
  if (index === null) return null;
  const outline = shapeToOutline(decodeGlyphShape(font.shapes[index]!));
  return outline && outline.contours.length > 0 ? outline : null;
};

/**
 * Size of a flat-footed glyph with vertical stems («H», «n»): its height, stem width,
 * and where its foot is — on the baseline (0) in a Latin font, but some CJK fonts
 * draw their Cyrillic raised off it.
 */
export type StemMetrics = { height: number; stem: number; foot: number };

export const stemMetrics = (outline: GlyphOutline): StemMetrics | null => {
  const box = outlineBounds(outline);
  const height = box.yMax - box.yMin;
  // A quarter of the way up: below the bar of «H» and the shoulder of «n».
  const xs = outlineCrossings(outline, Math.round(box.yMin * 0.25 + box.yMax * 0.75));
  if (height <= 0 || xs.length < 2) return null;
  return { height, stem: xs[1]! - xs[0]!, foot: box.yMax };
};

/** Side bearings of a glyph in its own font, `null` without advances. */
export const sideBearings = (
  font: DefineFont,
  char: string,
): { left: number; right: number } | null => {
  const index = glyphIndex(font, char);
  const outline = glyphOutline(font, char);
  const advance = index === null ? null : glyphAdvance(font, index);
  if (!outline || advance === null) return null;
  const box = outlineBounds(outline);
  return { left: box.xMin, right: advance - box.xMax };
};

export type FittedGlyph = { shape: Buffer; advance: number; bounds: ShapeBounds };

/** Most a condensed letter's stems may grow, as a share of the target stem, per side. */
const MAX_COMPENSATION = 0.35;
/** Narrowest a letter is condensed to fit a monospace cell. */
const MIN_SQUEEZE = 0.75;
/** Share of a monospace cell a letter's ink may fill. */
export const MONO_INK_SHARE = 0.9;

export type FitSpec = {
  /** Where the donor's letters stand, in its units; they are first moved onto the baseline. */
  foot: number;
  /** Outward offset in the donor's units; negative thins. */
  delta: number;
  /** Uniform scale applied after the offset, around the baseline origin. */
  scale: number;
  left: number;
  right: number;
  /**
   * The target is monospaced: every glyph takes this advance, centred, and a letter
   * wider than `maxInk` is condensed towards it, as a monospace design condenses «Ш»;
   * its vertical strokes are thickened first so they come out `stem` wide.
   */
  mono?: { advance: number; maxInk: number; stem: number };
};

/**
 * Re-weight, scale and re-space an outline.
 *
 * Emboldening grows a letter by `delta` on every side, so it would also stand
 * `delta` below the baseline; the result is moved back up by the same amount, which
 * `fitFactors` already allowed for when it chose the scale.
 *
 * @returns Shape bytes, advance and ink box in the target font's units.
 */
export const fitOutline = (outline: GlyphOutline, spec: FitSpec): FittedGlyph => {
  const grounded = mapOutline(outline, (p) => ({ x: p.x, y: p.y - spec.foot }));
  const weighted = emboldenOutline(grounded, spec.delta);
  const lift = spec.delta * spec.scale;
  const scaled = mapOutline(weighted, (p) => ({
    x: p.x * spec.scale,
    y: p.y * spec.scale - lift,
  }));
  const { mono } = spec;
  const natural = outlineBounds(scaled);
  const naturalWidth = natural.xMax - natural.xMin;
  // A monospace cell takes a wide letter condensed, but never past MIN_SQUEEZE: a
  // letter that would need more («Ж» from a full-width donor) widens its cell instead.
  const inkWidth = mono
    ? Math.min(naturalWidth, Math.max(mono.maxInk, naturalWidth * MIN_SQUEEZE))
    : naturalWidth;
  // Condensing by q thins stems by q too, so they first grow by just enough that
  // (stem + 2·dx)·q = stem while (width + 2·dx)·q = inkWidth, within a cap.
  const grow =
    mono && inkWidth < naturalWidth
      ? Math.min(
          (mono.stem * (naturalWidth - inkWidth)) / (2 * (inkWidth - mono.stem)),
          mono.stem * MAX_COMPENSATION,
        )
      : 0;
  const widened = grow > 0 ? emboldenOutline(scaled, grow, 0) : scaled;
  const box = outlineBounds(widened);
  const squeeze = inkWidth / (box.xMax - box.xMin);
  const advance = mono
    ? Math.max(mono.advance, Math.round(inkWidth / MONO_INK_SHARE))
    : Math.round(spec.left + inkWidth + spec.right);
  const left = mono ? (advance - inkWidth) / 2 : spec.left;
  const shifted = mapOutline(widened, (p) => ({
    x: (p.x - box.xMin) * squeeze + left,
    y: p.y,
  }));
  return {
    shape: encodeGlyphShape(outlineToShape(shifted)),
    advance,
    bounds: outlineBounds(shifted),
  };
};

/**
 * Offset and scale that carry a donor's letters over to a target font.
 *
 * Both must hold at once: after growing by `delta` on every side and scaling, the
 * donor's reference letter is exactly as tall as the target's, and its stem exactly
 * as wide — `(stem + 2δ) / (height + 2δ) = targetStem / targetHeight`.
 *
 * @param target - Stems of the target's reference letter («H» or «x»/«n»).
 * @param donor - Stems of the donor's matching Cyrillic letter («Н» or «х»/«н»).
 */
export const fitFactors = (
  target: StemMetrics,
  donor: StemMetrics,
): { foot: number; scale: number; delta: number } => {
  const delta =
    (target.stem * donor.height - target.height * donor.stem) / (2 * (target.height - target.stem));
  return { foot: donor.foot, delta, scale: target.height / (donor.height + 2 * delta) };
};

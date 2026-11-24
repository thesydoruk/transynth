/**
 * Turn one glyph recipe into an outline for a given font.
 *
 * `same` recipes work inside the target font — a copy, a mirror image, an upturn,
 * a stretched hyphen, a repeated period. `donor` recipes borrow from the matched
 * donor font and fit the result (`glyphFit`). Every builder returns `null` when its
 * source is missing, so the caller can fall through to the next recipe.
 */
import { glyphAdvance, type DefineFont } from './defineFontTag';
import { addJoinedUpturn, repeatGlyph, stretchGlyphX } from './glyphCompose';
import { mapOutline } from './glyphContours';
import { mirrorGlyphX } from './glyphDerive';
import {
  MONO_INK_SHARE,
  fitFactors,
  fitOutline,
  glyphIndex,
  glyphOutline,
  sideBearings,
  stemMetrics,
  type StemMetrics,
} from './glyphFit';
import type { GlyphRecipe } from './glyphRecipes';
import {
  decodeGlyphShape,
  encodeGlyphShape,
  shapeBounds,
  type GlyphShape,
  type ShapeBounds,
} from './glyphShape';

export type BuiltGlyph = {
  shape: Buffer;
  advance: number;
  bounds: ShapeBounds;
  /** Glyph whose hinting zones the new one shares. */
  zoneFrom: string;
};

type CaseFit = { foot: number; scale: number; delta: number };

export type FitContext = {
  /** The font being extended; `same` recipes read the letters added so far. */
  font: DefineFont;
  donor: DefineFont | null;
  /**
   * Highest y an added outline may reach: the font's ascent, or the top of its tallest
   * glyph when accented capitals already rise above it. Up is negative.
   */
  topLimit: number | undefined;
  upper: CaseFit | null;
  lower: CaseFit | null;
  /** Set when every Latin letter of the target has the same advance. */
  mono: { advance: number; maxInk: number; stem: number } | null;
};

const LATIN_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** The shared advance and widest ink of a monospaced font, `null` for a proportional one. */
const monospace = (font: DefineFont): FitContext['mono'] => {
  const advances = new Set<number>();
  let maxInk = 0;
  for (const char of LATIN_LETTERS) {
    const index = glyphIndex(font, char);
    const advance = index === null ? null : glyphAdvance(font, index);
    if (index === null || advance === null) continue;
    advances.add(advance);
    const box = shapeBounds(decodeGlyphShape(font.shapes[index]!));
    maxInk = Math.max(maxInk, box.xMax - box.xMin);
  }
  const stem = glyphOutline(font, 'H');
  const stemWidth = stem && stemMetrics(stem)?.stem;
  if (advances.size !== 1 || !stemWidth) return null;
  const advance = [...advances][0]!;
  // Wide Cyrillic letters may run closer to the cell edge than any Latin one does.
  return { advance, maxInk: Math.max(maxInk, advance * MONO_INK_SHARE), stem: stemWidth };
};

/** Height of one glyph combined with the stem of another, e.g. «x» height with «n» stems. */
const caseMetrics = (font: DefineFont, heightRef: string, stemRef: string): StemMetrics | null => {
  const heightOutline = glyphOutline(font, heightRef);
  const stemOutline = glyphOutline(font, stemRef);
  const height = heightOutline && stemMetrics(heightOutline);
  const stem = stemOutline && stemMetrics(stemOutline);
  return height && stem ? { ...height, stem: stem.stem } : null;
};

const caseFit = (
  font: DefineFont,
  donor: DefineFont,
  refs: [string, string],
  donorRefs: [string, string],
): CaseFit | null => {
  const target = caseMetrics(font, ...refs);
  const source = caseMetrics(donor, ...donorRefs);
  return target && source ? fitFactors(target, source) : null;
};

/**
 * Measure how the donor's letters map onto the target font.
 *
 * Capitals compare «H» with «Н»; lowercase compares «x» with «х» for height and «n»
 * with «н» for stems, because «n» rises above the x-height at its shoulder.
 */
export const fitContext = (
  font: DefineFont,
  donor: DefineFont | null,
  topLimit: number | undefined,
): FitContext => ({
  font,
  donor,
  topLimit,
  upper: donor && caseFit(font, donor, ['H', 'H'], ['Н', 'Н']),
  lower: donor && caseFit(font, donor, ['x', 'n'], ['х', 'н']),
  mono: monospace(font),
});

const built = (shape: GlyphShape, advance: number, zoneFrom: string): BuiltGlyph => {
  const bytes = encodeGlyphShape(shape);
  return { shape: bytes, advance, bounds: shapeBounds(shape), zoneFrom };
};

/** Ink width of a dash: an en dash spans an «n», an em dash twice that. */
const dashWidth = (font: DefineFont, char: string, hyphen: { left: number; right: number }) => {
  const n = glyphIndex(font, 'n');
  const advance = n === null ? null : glyphAdvance(font, n);
  if (advance === null) return null;
  const en = advance - hyphen.left - hyphen.right;
  return char === '—' ? en * 2 + hyphen.left + hyphen.right : en;
};

const buildSame = (
  context: FitContext,
  char: string,
  recipe: Extract<GlyphRecipe, { kind: 'same' }>,
): BuiltGlyph | null => {
  const { font } = context;
  const index = glyphIndex(font, recipe.from);
  const advance = index === null ? null : glyphAdvance(font, index);
  if (index === null || advance === null) return null;
  const shape = decodeGlyphShape(font.shapes[index]!);

  switch (recipe.transform) {
    case undefined:
      return { ...built(shape, advance, recipe.from), shape: Buffer.from(font.shapes[index]!) };
    case 'mirror':
      return built(mirrorGlyphX(shape), advance, recipe.from);
    case 'upturn': {
      const upturned = addJoinedUpturn(shape, context.topLimit);
      return upturned && built(upturned, advance, recipe.from);
    }
    case 'dash': {
      const bearings = sideBearings(font, recipe.from);
      const width = bearings && dashWidth(font, char, bearings);
      const dash = width ? stretchGlyphX(shape, width) : null;
      return dash && bearings && built(dash, bearings.left + width! + bearings.right, recipe.from);
    }
    case 'ellipsis': {
      const dots = repeatGlyph(shape, 3, advance);
      return dots && built(dots, advance * 3, recipe.from);
    }
  }
};

const buildDonor = (
  context: FitContext,
  char: string,
  recipe: Extract<GlyphRecipe, { kind: 'donor' }>,
): BuiltGlyph | null => {
  const { font, donor } = context;
  const fit = char !== char.toUpperCase() ? context.lower : context.upper;
  if (!donor || !fit) return null;

  let outline = glyphOutline(donor, recipe.from ?? char);
  if (outline && recipe.transform === 'mirror') {
    const box = shapeBounds(
      decodeGlyphShape(donor.shapes[glyphIndex(donor, recipe.from ?? char)!]!),
    );
    outline = mapOutline(outline, (p) => ({ x: box.xMin + box.xMax - p.x, y: p.y }));
  }
  const left = sideBearings(font, recipe.left);
  const right = sideBearings(font, recipe.right);
  if (!outline || !left || !right) return null;

  const fitted = fitOutline(outline, {
    ...fit,
    left: left.left,
    right: right.right,
    ...(context.mono && { mono: context.mono }),
  });
  return { ...fitted, zoneFrom: recipe.left };
};

/** Build `char` by one recipe, or `null` when the recipe's source is not there. */
export const buildGlyph = (
  context: FitContext,
  char: string,
  recipe: GlyphRecipe,
): BuiltGlyph | null =>
  recipe.kind === 'same' ? buildSame(context, char, recipe) : buildDonor(context, char, recipe);

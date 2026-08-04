/**
 * Repair placeholder glyphs in a Bethesda SWF font library.
 *
 * Vanilla `fonts_en.swf` lists the whole Cyrillic block in its code tables but points
 * most of it at a single box outline, so Ukrainian «і/ї/є/ґ» render as boxes even
 * though the code points are "supported". Each broken letter is rebuilt from a glyph
 * the same font already draws: «і» is the Latin «i», «Є» is a mirrored «Э», «Ґ» is
 * «Г» with an upturn. Staying inside the font preserves its weight, width and
 * monospace advance.
 *
 * Glyph count never changes, so the advance, bounds and kerning tables indexed by
 * glyph stay valid.
 */
import { createHash } from 'crypto';
import { log } from '../../logger';
import {
  fontAscent,
  glyphAdvance,
  parseDefineFontTag,
  setGlyphAdvance,
  writeDefineFontTag,
  type DefineFont,
} from './defineFontTag';
import { addUpturn, mirrorGlyphX } from './glyphDerive';
import { decodeGlyphShape, encodeGlyphShape } from './glyphShape';
import { PLACEHOLDER_MIN_SHARED } from './swfFonts';
import { parseSwf, writeSwf } from './swfTags';

const TAG_DEFINE_FONT2 = 48;
const TAG_DEFINE_FONT3 = 75;

/** How the outline of `to` is built from the outline of `from`. */
export type GlyphOp = {
  kind: 'copy' | 'mirror' | 'upturn';
  from: string;
  to: string;
};

export type GlyphOpResult = {
  font: string;
  op: GlyphOp;
  applied: boolean;
  reason?:
    | 'source-missing'
    | 'target-missing'
    | 'already-drawn'
    | 'already-equal'
    | 'derive-failed';
};

export type FontPatchResult = {
  buffer: Buffer;
  results: GlyphOpResult[];
  /** Number of outlines actually replaced. */
  appliedCount: number;
};

const codePointOf = (char: string): number => char.codePointAt(0)!;

/** Build the target outline from the source glyph's bytes. */
const deriveShape = (kind: GlyphOp['kind'], source: Buffer, topLimit?: number): Buffer | null => {
  if (kind === 'copy') return Buffer.from(source);
  const shape = decodeGlyphShape(source);
  const derived = kind === 'mirror' ? mirrorGlyphX(shape) : addUpturn(shape, topLimit);
  return derived ? encodeGlyphShape(derived) : null;
};

/**
 * Glyph indexes whose outline is reused across a large group of code points.
 *
 * A font that only pretends to cover a character points it at one shared box, so a
 * crowded outline group marks the glyphs that are safe — and worth — replacing. Fonts
 * that draw a letter properly, like Roboto Condensed's «є», are left alone.
 */
const placeholderIndexes = (font: DefineFont): Set<number> => {
  const groups = new Map<string, number[]>();
  font.shapes.forEach((shape, index) => {
    const key = createHash('sha1').update(shape).digest('hex');
    const list = groups.get(key);
    if (list) list.push(index);
    else groups.set(key, [index]);
  });

  const placeholders = new Set<number>();
  for (const list of groups.values()) {
    if (list.length >= PLACEHOLDER_MIN_SHARED) list.forEach((index) => placeholders.add(index));
  }
  return placeholders;
};

/** Apply every operation to one font, reporting each outcome. */
const patchFont = (font: DefineFont, ops: GlyphOp[], results: GlyphOpResult[]): number => {
  const placeholders = placeholderIndexes(font);
  const ascent = fontAscent(font);
  const topLimit = ascent === null ? undefined : -ascent;
  let applied = 0;

  for (const op of ops) {
    const fromIndex = font.codePoints.indexOf(codePointOf(op.from));
    const toIndex = font.codePoints.indexOf(codePointOf(op.to));
    if (fromIndex === -1) {
      results.push({ font: font.name, op, applied: false, reason: 'source-missing' });
      continue;
    }
    if (toIndex === -1) {
      results.push({ font: font.name, op, applied: false, reason: 'target-missing' });
      continue;
    }
    if (!placeholders.has(toIndex)) {
      results.push({ font: font.name, op, applied: false, reason: 'already-drawn' });
      continue;
    }

    const shape = deriveShape(op.kind, font.shapes[fromIndex]!, topLimit);
    if (!shape) {
      results.push({ font: font.name, op, applied: false, reason: 'derive-failed' });
      continue;
    }
    if (shape.equals(font.shapes[toIndex]!)) {
      results.push({ font: font.name, op, applied: false, reason: 'already-equal' });
      continue;
    }

    font.shapes[toIndex] = shape;
    const advance = glyphAdvance(font, fromIndex);
    if (advance !== null) setGlyphAdvance(font, toIndex, advance);
    results.push({ font: font.name, op, applied: true });
    applied++;
  }

  return applied;
};

/**
 * Rebuild broken glyphs of an SWF font library from the fonts' own outlines.
 *
 * @param swfBuffer - Raw `.swf` font library.
 * @param ops - Outline derivations to apply to every matching font.
 * @param fontNames - Restrict to these font names; all fonts when omitted.
 * @returns Rewritten library plus a per-font report of what was applied.
 */
export const patchFontGlyphs = (
  swfBuffer: Buffer,
  ops: GlyphOp[],
  fontNames?: string[],
): FontPatchResult => {
  const swf = parseSwf(swfBuffer);
  const wanted = fontNames?.map((name) => name.toLowerCase());
  const results: GlyphOpResult[] = [];
  let appliedCount = 0;

  swf.tags = swf.tags.map((tag) => {
    if (tag.code !== TAG_DEFINE_FONT2 && tag.code !== TAG_DEFINE_FONT3) return tag;
    const font = parseDefineFontTag(tag.body);
    if (!font) return tag;
    if (wanted && !wanted.includes(font.name.toLowerCase())) return tag;

    const applied = patchFont(font, ops, results);
    if (applied === 0) return tag;
    appliedCount += applied;
    log.info(`SWF font patch: rewrote ${applied} glyph(s) of ${font.name}`);
    return { code: tag.code, body: writeDefineFontTag(font) };
  });

  return { buffer: writeSwf(swf), results, appliedCount };
};

/**
 * Ukrainian letters vanilla fonts draw as boxes, and how to rebuild each one.
 *
 * «і/ї» share their shape with Latin «i/ï», so those are plain copies; «є» and «ґ»
 * are derived from «э» and «г».
 */
export const UKRAINIAN_GLYPH_OPS: GlyphOp[] = [
  { kind: 'copy', from: 'i', to: 'і' },
  { kind: 'copy', from: 'I', to: 'І' },
  { kind: 'copy', from: 'ï', to: 'ї' },
  { kind: 'copy', from: 'Ï', to: 'Ї' },
  { kind: 'mirror', from: 'э', to: 'є' },
  { kind: 'mirror', from: 'Э', to: 'Є' },
  { kind: 'upturn', from: 'г', to: 'ґ' },
  { kind: 'upturn', from: 'Г', to: 'Ґ' },
];

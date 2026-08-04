/**
 * Glyph coverage of Scaleform/Flash font libraries (`Interface/fonts_*.swf`).
 *
 * Bethesda games embed their UI fonts as `DefineFont2`/`DefineFont3` tags inside
 * SWF font libraries, and `Interface/FontConfig.txt` maps logical names such as
 * `$MAIN_Font` or `$Terminal_Font` onto the font families found there. A glyph the
 * family does not embed renders as a missing-glyph box in game, which is how
 * Ukrainian «і/ї/є/ґ» disappear from fonts that only carry Russian Cyrillic.
 *
 * Only the font name and code table are decoded — shapes and layout are skipped.
 */
import { createHash } from 'crypto';
import { parseDefineFontTag, type DefineFont } from './defineFontTag';
import { parseSwf } from './swfTags';

const TAG_DEFINE_FONT2 = 48;
const TAG_DEFINE_FONT3 = 75;
const TAG_DEFINE_FONT_NAME = 88;
const TAG_DEFINE_FONT4 = 91;

export type SwfGlyph = {
  codePoint: number;
  /** Byte length of the glyph's shape record. */
  shapeSize: number;
  /**
   * Digest of the shape bytes. Fonts that only pretend to support a character map
   * it to a shared placeholder outline, so identical digests across unrelated code
   * points mean the glyph draws the same box everywhere.
   */
  shapeHash: string;
};

export type SwfFont = {
  fontId: number;
  /** Name from the font tag, e.g. `Share-TechMono Regular`. */
  name: string;
  /** Full family name from a `DefineFontName` tag, when the library has one. */
  displayName?: string;
  /** Code points the font embeds a glyph for. */
  codePoints: Set<number>;
  /** Per-code-point glyph outlines, in font order. */
  glyphs: SwfGlyph[];
  /** `DefineFont4` embeds an OpenType/CFF blob whose coverage is not decoded here. */
  cffOnly?: boolean;
};

const readNulString = (buf: Buffer, start: number): string => {
  let end = start;
  while (end < buf.length && buf[end] !== 0) end++;
  return buf.toString('utf8', start, end);
};

const toSwfFont = (font: DefineFont): SwfFont => ({
  fontId: font.fontId,
  name: font.name,
  codePoints: new Set(font.codePoints),
  glyphs: font.shapes.map((shape, i) => ({
    codePoint: font.codePoints[i]!,
    shapeSize: shape.length,
    shapeHash: createHash('sha1').update(shape).digest('hex').slice(0, 12),
  })),
});

/**
 * List every embedded font of an SWF font library with the code points it covers.
 *
 * @param buf - Raw `.swf` contents.
 * @returns One entry per font tag, in file order.
 */
export const readSwfFonts = (buf: Buffer): SwfFont[] => {
  const swf = parseSwf(buf);
  const fonts: SwfFont[] = [];
  const names = new Map<number, string>();

  for (const { code, body } of swf.tags) {
    if (code === TAG_DEFINE_FONT2 || code === TAG_DEFINE_FONT3) {
      const font = parseDefineFontTag(body);
      if (font) fonts.push(toSwfFont(font));
    } else if (code === TAG_DEFINE_FONT4 && body.length >= 5) {
      fonts.push({
        fontId: body.readUInt16LE(0),
        name: readNulString(body, 3),
        codePoints: new Set(),
        glyphs: [],
        cffOnly: true,
      });
    } else if (code === TAG_DEFINE_FONT_NAME && body.length >= 3) {
      names.set(body.readUInt16LE(0), readNulString(body, 2));
    }
  }

  return fonts.map((font) => {
    const displayName = names.get(font.fontId);
    return displayName ? { ...font, displayName } : font;
  });
};

/** Code points of a string, for coverage checks. */
export const codePointsOf = (text: string): number[] => [...text].map((ch) => ch.codePointAt(0)!);

/** Characters of `text` that a font does not embed a glyph for. */
export const missingGlyphs = (font: SwfFont, text: string): string[] =>
  [...text].filter((ch) => !font.codePoints.has(ch.codePointAt(0)!));

/**
 * Group size at which a shared outline is taken to be a placeholder rather than a
 * deliberately reused shape.
 *
 * Look-alike clusters are real and can be several code points wide: a well-built font
 * draws Cyrillic «І» with the same outline as Latin «I», Greek «Ι», the Roman numeral
 * and the fullwidth form. A `.notdef` box, on the other hand, is reused across dozens
 * — Bethesda's terminal font shares one across 192 — so the line sits well above any
 * plausible cluster.
 */
export const PLACEHOLDER_MIN_SHARED = 16;

export type PlaceholderGlyph = {
  char: string;
  shapeSize: number;
  /** How many other code points of the font draw the very same outline. */
  sharedWith: number;
  /** Sample of the code points sharing the outline. */
  sharedChars: string[];
};

/**
 * Find characters that the font maps to an outline shared with unrelated ones.
 *
 * A font can list a code point in its table yet draw a placeholder box for it, so
 * coverage alone does not prove a character is readable in game. Such fonts reuse
 * one `.notdef` outline across every unsupported code point, so a large group of
 * code points sharing an outline is the signal. Small groups are legitimate: «і»
 * and Latin «i» are the same shape, and designers do share those outlines.
 *
 * @param font - Font to inspect.
 * @param text - Characters to check.
 * @param minShared - Group size an outline must reach before it counts as reused.
 */
export const placeholderGlyphs = (
  font: SwfFont,
  text: string,
  minShared = PLACEHOLDER_MIN_SHARED,
): PlaceholderGlyph[] => {
  const byHash = new Map<string, number[]>();
  for (const glyph of font.glyphs) {
    const list = byHash.get(glyph.shapeHash);
    if (list) list.push(glyph.codePoint);
    else byHash.set(glyph.shapeHash, [glyph.codePoint]);
  }

  const found: PlaceholderGlyph[] = [];
  for (const char of new Set(text)) {
    const codePoint = char.codePointAt(0)!;
    const glyph = font.glyphs.find((g) => g.codePoint === codePoint);
    if (!glyph) continue;
    const sharing = byHash.get(glyph.shapeHash) ?? [];
    if (sharing.length < minShared) continue;
    found.push({
      char,
      shapeSize: glyph.shapeSize,
      sharedWith: sharing.length - 1,
      sharedChars: sharing
        .filter((cp) => cp !== codePoint)
        .slice(0, 8)
        .map((cp) => String.fromCodePoint(cp)),
    });
  }
  return found;
};

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
import { inflateSync } from 'zlib';

const TAG_DEFINE_FONT2 = 48;
const TAG_DEFINE_FONT3 = 75;
const TAG_DEFINE_FONT_NAME = 88;
const TAG_DEFINE_FONT4 = 91;

const FLAG_WIDE_OFFSETS = 0x08;
const FLAG_WIDE_CODES = 0x04;

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

/** Decompress a `CWS` (zlib) SWF into the equivalent uncompressed byte layout. */
const decompressSwf = (buf: Buffer): Buffer => {
  const signature = buf.toString('ascii', 0, 3);
  if (signature === 'FWS') return buf;
  if (signature === 'CWS') {
    return Buffer.concat([
      Buffer.from('FWS', 'ascii'),
      buf.subarray(3, 8),
      inflateSync(buf.subarray(8)),
    ]);
  }
  throw new Error(`Unsupported SWF signature "${signature}" (only FWS and CWS are handled)`);
};

/** Offset of the first tag: 8-byte header, frame size RECT, frame rate, frame count. */
const firstTagOffset = (buf: Buffer): number => {
  const nbits = buf[8] >> 3;
  const rectBits = 5 + 4 * nbits;
  return 8 + Math.ceil(rectBits / 8) + 4;
};

const readNulString = (buf: Buffer, start: number): { text: string; end: number } => {
  let end = start;
  while (end < buf.length && buf[end] !== 0) end++;
  return { text: buf.toString('utf8', start, end), end: end + 1 };
};

/** Decode the name, code table and glyph outlines of a DefineFont2/3 tag body. */
const parseDefineFont = (body: Buffer): SwfFont | null => {
  if (body.length < 5) return null;
  const fontId = body.readUInt16LE(0);
  const flags = body[2];
  const nameLen = body[4];
  const name = body.toString('utf8', 5, 5 + nameLen).replace(/\0+$/, '');

  let pos = 5 + nameLen;
  if (pos + 2 > body.length) return null;
  const numGlyphs = body.readUInt16LE(pos);
  pos += 2;

  const wideOffsets = (flags & FLAG_WIDE_OFFSETS) !== 0;
  const wideCodes = (flags & FLAG_WIDE_CODES) !== 0;
  const offsetTableStart = pos;
  const offsetSize = wideOffsets ? 4 : 2;
  const codeTableOffsetPos = offsetTableStart + numGlyphs * offsetSize;
  if (codeTableOffsetPos + offsetSize > body.length) return null;

  const codeTableOffset = wideOffsets
    ? body.readUInt32LE(codeTableOffsetPos)
    : body.readUInt16LE(codeTableOffsetPos);

  const readOffset = (index: number): number =>
    wideOffsets
      ? body.readUInt32LE(offsetTableStart + index * 4)
      : body.readUInt16LE(offsetTableStart + index * 2);

  const codePoints = new Set<number>();
  const glyphs: SwfGlyph[] = [];
  const codeSize = wideCodes ? 2 : 1;
  let codePos = offsetTableStart + codeTableOffset;

  for (let i = 0; i < numGlyphs; i++) {
    if (codePos + codeSize > body.length) break;
    const codePoint = wideCodes ? body.readUInt16LE(codePos) : body[codePos];
    codePos += codeSize;
    codePoints.add(codePoint);

    // The shape of the last glyph runs up to the code table.
    const shapeStart = offsetTableStart + readOffset(i);
    const shapeEnd = offsetTableStart + (i + 1 < numGlyphs ? readOffset(i + 1) : codeTableOffset);
    if (shapeStart > shapeEnd || shapeEnd > body.length) continue;
    const shape = body.subarray(shapeStart, shapeEnd);
    glyphs.push({
      codePoint,
      shapeSize: shape.length,
      shapeHash: createHash('sha1').update(shape).digest('hex').slice(0, 12),
    });
  }

  return { fontId, name, codePoints, glyphs };
};

/**
 * List every embedded font of an SWF font library with the code points it covers.
 *
 * @param buf - Raw `.swf` contents.
 * @returns One entry per font tag, in file order.
 */
export const readSwfFonts = (buf: Buffer): SwfFont[] => {
  const swf = decompressSwf(buf);
  const fonts: SwfFont[] = [];
  const names = new Map<number, string>();
  let pos = firstTagOffset(swf);

  while (pos + 2 <= swf.length) {
    const header = swf.readUInt16LE(pos);
    const code = header >> 6;
    let length = header & 0x3f;
    pos += 2;
    if (length === 0x3f) {
      if (pos + 4 > swf.length) break;
      length = swf.readUInt32LE(pos);
      pos += 4;
    }
    if (code === 0) break; // End tag
    const body = swf.subarray(pos, pos + length);
    pos += length;

    if (code === TAG_DEFINE_FONT2 || code === TAG_DEFINE_FONT3) {
      const font = parseDefineFont(body);
      if (font) fonts.push(font);
    } else if (code === TAG_DEFINE_FONT4 && body.length >= 5) {
      const nameEnd = readNulString(body, 3);
      fonts.push({
        fontId: body.readUInt16LE(0),
        name: nameEnd.text,
        codePoints: new Set(),
        glyphs: [],
        cffOnly: true,
      });
    } else if (code === TAG_DEFINE_FONT_NAME && body.length >= 3) {
      names.set(body.readUInt16LE(0), readNulString(body, 2).text);
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
  minShared = 5,
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

/**
 * `DefineFont2` / `DefineFont3` tag bodies: decode and re-encode.
 *
 * Layout of the body (SWF spec, chapter on fonts):
 *   FontID, flags, language, name, glyph count,
 *   offset table (one per glyph) + code table offset — all relative to the start
 *   of the offset table, shape records, code table, and an optional layout section
 *   (ascent/descent/leading, advance and bounds tables, kerning pairs).
 *
 * Glyph shapes are byte-aligned, self-contained `SHAPE` records that use the font's
 * implicit fill style, so a shape can be moved or duplicated between glyphs of the
 * same font as raw bytes. The layout section is indexed by glyph and stays valid as
 * long as the glyph count does not change, so it is preserved verbatim.
 */

const FLAG_WIDE_OFFSETS = 0x08;
const FLAG_WIDE_CODES = 0x04;
const FLAG_HAS_LAYOUT = 0x80;

/** Ascent, descent and leading precede the advance table in the layout section. */
const ADVANCE_TABLE_OFFSET = 6;

export type DefineFont = {
  fontId: number;
  flags: number;
  languageCode: number;
  /** Font name for matching and logging; trailing NUL padding stripped. */
  name: string;
  /** Name bytes exactly as stored, so re-encoding keeps Bethesda's NUL padding. */
  nameRaw: Buffer;
  /** Shape record per glyph, in font order. */
  shapes: Buffer[];
  /** Code point per glyph, in font order. */
  codePoints: number[];
  /** Layout section following the code table, kept as-is. */
  layout: Buffer;
};

export const isWideCodes = (font: DefineFont): boolean => (font.flags & FLAG_WIDE_CODES) !== 0;

const advanceAt = (font: DefineFont, index: number): number | null => {
  if ((font.flags & FLAG_HAS_LAYOUT) === 0) return null;
  const at = ADVANCE_TABLE_OFFSET + index * 2;
  return at + 2 <= font.layout.length ? at : null;
};

/**
 * Distance the font claims above the baseline, or `null` without a layout section.
 * Outlines reaching past it risk being clipped by the UI.
 */
export const fontAscent = (font: DefineFont): number | null =>
  (font.flags & FLAG_HAS_LAYOUT) !== 0 && font.layout.length >= 2
    ? font.layout.readInt16LE(0)
    : null;

/** Horizontal advance of a glyph in font units, or `null` without a layout section. */
export const glyphAdvance = (font: DefineFont, index: number): number | null => {
  const at = advanceAt(font, index);
  return at === null ? null : font.layout.readInt16LE(at);
};

/**
 * Set the horizontal advance of a glyph.
 *
 * Placeholder glyphs carry the advance of the box they drew — half width for the
 * capitals of Bethesda's terminal font — so a repaired glyph has to inherit the
 * advance of the letter it was built from, or it will overlap its neighbour.
 *
 * @returns Whether the advance could be written.
 */
export const setGlyphAdvance = (font: DefineFont, index: number, advance: number): boolean => {
  const at = advanceAt(font, index);
  if (at === null) return false;
  font.layout.writeInt16LE(advance, at);
  return true;
};

/**
 * Decode a DefineFont2/3 tag body.
 *
 * @param body - Tag body without the record header.
 * @returns Decoded font, or `null` when the body is truncated or malformed.
 */
export const parseDefineFontTag = (body: Buffer): DefineFont | null => {
  if (body.length < 5) return null;
  const fontId = body.readUInt16LE(0);
  const flags = body[2];
  const languageCode = body[3];
  const nameLen = body[4];
  const nameRaw = Buffer.from(body.subarray(5, 5 + nameLen));
  const name = nameRaw.toString('utf8').replace(/\0+$/, '');

  const glyphCountPos = 5 + nameLen;
  if (glyphCountPos + 2 > body.length) return null;
  const numGlyphs = body.readUInt16LE(glyphCountPos);

  const wideOffsets = (flags & FLAG_WIDE_OFFSETS) !== 0;
  const wideCodes = (flags & FLAG_WIDE_CODES) !== 0;
  const offsetSize = wideOffsets ? 4 : 2;
  const offsetTableStart = glyphCountPos + 2;
  const codeTableOffsetPos = offsetTableStart + numGlyphs * offsetSize;
  if (codeTableOffsetPos + offsetSize > body.length) return null;

  const readOffset = (index: number): number =>
    wideOffsets
      ? body.readUInt32LE(offsetTableStart + index * 4)
      : body.readUInt16LE(offsetTableStart + index * 2);
  const codeTableOffset = wideOffsets
    ? body.readUInt32LE(codeTableOffsetPos)
    : body.readUInt16LE(codeTableOffsetPos);

  const shapes: Buffer[] = [];
  for (let i = 0; i < numGlyphs; i++) {
    const start = offsetTableStart + readOffset(i);
    const end = offsetTableStart + (i + 1 < numGlyphs ? readOffset(i + 1) : codeTableOffset);
    if (start > end || end > body.length) return null;
    shapes.push(Buffer.from(body.subarray(start, end)));
  }

  const codeSize = wideCodes ? 2 : 1;
  const codeTableStart = offsetTableStart + codeTableOffset;
  const codeTableEnd = codeTableStart + numGlyphs * codeSize;
  if (codeTableEnd > body.length) return null;

  const codePoints: number[] = [];
  for (let i = 0; i < numGlyphs; i++) {
    const at = codeTableStart + i * codeSize;
    codePoints.push(wideCodes ? body.readUInt16LE(at) : body[at]);
  }

  return {
    fontId,
    flags,
    languageCode,
    name,
    nameRaw,
    shapes,
    codePoints,
    layout: Buffer.from(body.subarray(codeTableEnd)),
  };
};

/**
 * Encode a DefineFont2/3 tag body.
 *
 * Keeps the source's offset table width, so an untouched font re-encodes byte for
 * byte, and widens it when replacing a shared placeholder outline with per-glyph
 * shapes grows the blob past what 16-bit offsets can address.
 *
 * @param font - Font to encode.
 * @returns Tag body ready to be wrapped in a record header.
 */
export const writeDefineFontTag = (font: DefineFont): Buffer => {
  const nameBuf = font.nameRaw;
  const numGlyphs = font.shapes.length;
  const shapeBlob = Buffer.concat(font.shapes);
  const codeSize = isWideCodes(font) ? 2 : 1;

  const narrowTableSize = (numGlyphs + 1) * 2;
  const wideOffsets =
    (font.flags & FLAG_WIDE_OFFSETS) !== 0 ||
    narrowTableSize + shapeBlob.length + numGlyphs * codeSize > 0xffff;
  const offsetSize = wideOffsets ? 4 : 2;
  const offsetTableSize = (numGlyphs + 1) * offsetSize;

  const offsets = Buffer.alloc(offsetTableSize);
  let cursor = offsetTableSize;
  font.shapes.forEach((shape, i) => {
    if (wideOffsets) offsets.writeUInt32LE(cursor, i * 4);
    else offsets.writeUInt16LE(cursor, i * 2);
    cursor += shape.length;
  });
  if (wideOffsets) offsets.writeUInt32LE(cursor, numGlyphs * 4);
  else offsets.writeUInt16LE(cursor, numGlyphs * 2);

  const codeTable = Buffer.alloc(numGlyphs * codeSize);
  font.codePoints.forEach((codePoint, i) => {
    if (codeSize === 2) codeTable.writeUInt16LE(codePoint, i * 2);
    else codeTable.writeUInt8(codePoint, i);
  });

  const flags = wideOffsets ? font.flags | FLAG_WIDE_OFFSETS : font.flags & ~FLAG_WIDE_OFFSETS;
  const head = Buffer.alloc(5);
  head.writeUInt16LE(font.fontId, 0);
  head.writeUInt8(flags, 2);
  head.writeUInt8(font.languageCode, 3);
  head.writeUInt8(nameBuf.length, 4);

  const glyphCount = Buffer.alloc(2);
  glyphCount.writeUInt16LE(numGlyphs, 0);

  return Buffer.concat([head, nameBuf, glyphCount, offsets, shapeBlob, codeTable, font.layout]);
};

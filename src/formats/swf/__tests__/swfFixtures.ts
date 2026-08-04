/**
 * Hand-built SWF structures for tests.
 *
 * Written independently of the production reader and writer, so a test that feeds
 * these in is checking the code against the format rather than against itself.
 */
import { deflateSync } from 'zlib';

const FLAG_WIDE_CODES = 0x04;
const FLAG_HAS_LAYOUT = 0x80;

/** Wrap a tag body in a record header, using the long form when needed. */
export const tag = (code: number, body: Buffer): Buffer => {
  if (body.length < 0x3f) {
    const header = Buffer.alloc(2);
    header.writeUInt16LE((code << 6) | body.length, 0);
    return Buffer.concat([header, body]);
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE((code << 6) | 0x3f, 0);
  header.writeUInt32LE(body.length, 2);
  return Buffer.concat([header, body]);
};

export type DefineFont3Options = {
  /** Outline bytes per glyph; distinct dummy shapes by default. */
  shapeFor?: (codePoint: number, index: number) => Buffer;
  /** Adds a layout section with one advance per glyph. */
  advances?: number[];
  ascent?: number;
};

/** Build a DefineFont3 body with wide code points and one shape record per glyph. */
export const defineFont3 = (
  fontId: number,
  name: string,
  codePoints: number[],
  options: DefineFont3Options = {},
): Buffer => {
  const { shapeFor = (_, index) => Buffer.from([0x0f, index]), advances, ascent = 1000 } = options;
  const nameBuf = Buffer.from(name, 'utf8');
  const head = Buffer.alloc(5);
  head.writeUInt16LE(fontId, 0);
  head.writeUInt8(FLAG_WIDE_CODES | (advances ? FLAG_HAS_LAYOUT : 0), 2);
  head.writeUInt8(0, 3); // language code
  head.writeUInt8(nameBuf.length, 4);

  const numGlyphs = codePoints.length;
  const shapes = codePoints.map(shapeFor);
  const offsetTableSize = (numGlyphs + 1) * 2; // glyph offsets + code table offset

  const offsets = Buffer.alloc(offsetTableSize);
  let shapeOffset = offsetTableSize;
  shapes.forEach((shape, i) => {
    offsets.writeUInt16LE(shapeOffset, i * 2);
    shapeOffset += shape.length;
  });
  offsets.writeUInt16LE(shapeOffset, numGlyphs * 2);

  const codeTable = Buffer.alloc(numGlyphs * 2);
  codePoints.forEach((cp, i) => codeTable.writeUInt16LE(cp, i * 2));

  const glyphCount = Buffer.alloc(2);
  glyphCount.writeUInt16LE(numGlyphs, 0);

  const parts = [head, nameBuf, glyphCount, offsets, ...shapes, codeTable];
  if (advances) {
    // Ascent, descent, leading, advances, empty bounds per glyph, no kerning pairs.
    const layout = Buffer.alloc(6 + numGlyphs * 2 + numGlyphs + 2);
    layout.writeInt16LE(ascent, 0);
    layout.writeInt16LE(200, 2);
    layout.writeInt16LE(50, 4);
    advances.forEach((advance, i) => layout.writeInt16LE(advance, 6 + i * 2));
    parts.push(layout);
  }

  return Buffer.concat(parts);
};

export const defineFontName = (fontId: number, name: string): Buffer => {
  const id = Buffer.alloc(2);
  id.writeUInt16LE(fontId, 0);
  return Buffer.concat([id, Buffer.from(`${name}\0`, 'utf8'), Buffer.from('\0', 'utf8')]);
};

/** Assemble tags into an `FWS` or `CWS` container. */
export const buildSwf = (tags: Buffer[], compress = false): Buffer => {
  const rect = Buffer.from([0x00]); // nbits = 0
  const frameRate = Buffer.from([0x00, 0x18]);
  const frameCount = Buffer.from([0x01, 0x00]);
  const body = Buffer.concat([rect, frameRate, frameCount, ...tags, Buffer.from([0x00, 0x00])]);

  const header = Buffer.alloc(8);
  header.write(compress ? 'CWS' : 'FWS', 0, 3, 'ascii');
  header.writeUInt8(15, 3);
  header.writeUInt32LE(8 + body.length, 4);

  return Buffer.concat([header, compress ? deflateSync(body) : body]);
};

export const TAG_DEFINE_FONT3 = 75;
export const TAG_DEFINE_FONT_NAME = 88;

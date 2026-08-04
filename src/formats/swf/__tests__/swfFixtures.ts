/**
 * Hand-built SWF structures for tests.
 *
 * Written independently of the production reader and writer, so a test that feeds
 * these in is checking the code against the format rather than against itself.
 */
import { deflateSync } from 'zlib';
import { encodeGlyphShape, type GlyphShape } from '../glyphShape';

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

const outline = (records: GlyphShape['records']): Buffer =>
  encodeGlyphShape({ fillBits: 1, lineBits: 0, records });

const rect = (x: number, width: number, top: number): GlyphShape['records'] => [
  { kind: 'style', move: { x, y: top }, fill1: 1 },
  { kind: 'line', dx: width, dy: 0 },
  { kind: 'line', dx: 0, dy: -top },
  { kind: 'line', dx: -width, dy: 0 },
];

export const LATIN_I = 0x0069;
export const LATIN_I_DIAERESIS = 0x00ef;
export const RUSSIAN_E = 0x044d;
export const GHE = 0x0433;
export const UKRAINIAN_I = 0x0456;
export const YI = 0x0457;
export const IE = 0x0454;
export const GHE_UPTURN = 0x0491;

/**
 * Code points the sample library draws as one shared box, as vanilla fonts do.
 *
 * Large enough to read as a placeholder group rather than a look-alike cluster.
 */
export const BOXED_CODE_POINTS = [
  UKRAINIAN_I,
  YI,
  IE,
  GHE_UPTURN,
  0x2020,
  ...Array.from({ length: 15 }, (_, i) => 0x0400 + i), // Ѐ, Ђ, Ѓ, …
];

export const BOX_OUTLINE = outline(rect(0, 500, -900));

/** Outlines the sample library really draws, keyed by code point. */
export const REAL_OUTLINES: Record<number, Buffer> = {
  [LATIN_I]: outline(rect(100, 200, -700)),
  [LATIN_I_DIAERESIS]: outline(rect(100, 200, -900)),
  [RUSSIAN_E]: outline([
    { kind: 'style', move: { x: 100, y: -700 }, fill1: 1 },
    { kind: 'line', dx: 500, dy: 0 },
    { kind: 'curve', cdx: 200, cdy: 350, adx: -200, ady: 350 },
    { kind: 'line', dx: -500, dy: 0 },
  ]),
  [GHE]: outline([
    { kind: 'style', move: { x: 0, y: -1000 }, fill1: 1 },
    { kind: 'line', dx: 600, dy: 0 },
    { kind: 'line', dx: 0, dy: 150 },
    { kind: 'line', dx: -450, dy: 0 },
    { kind: 'line', dx: 0, dy: 850 },
    { kind: 'line', dx: -150, dy: 0 },
  ]),
};

export const SAMPLE_CODE_POINTS = [
  LATIN_I,
  LATIN_I_DIAERESIS,
  RUSSIAN_E,
  GHE,
  ...BOXED_CODE_POINTS,
];

/**
 * A stand-in for Bethesda's terminal font: real Latin and Russian letters, one shared
 * box for the Ukrainian ones, and the half-width advance those boxes carry.
 */
export const placeholderFontLibrary = (
  name = 'Share-TechMono Regular',
  extraTags: Buffer[] = [],
): Buffer =>
  buildSwf([
    tag(
      TAG_DEFINE_FONT3,
      defineFont3(1, name, SAMPLE_CODE_POINTS, {
        shapeFor: (cp) => REAL_OUTLINES[cp] ?? BOX_OUTLINE,
        advances: SAMPLE_CODE_POINTS.map((cp) => (BOXED_CODE_POINTS.includes(cp) ? 512 : 1100)),
        ascent: 1750,
      }),
    ),
    ...extraTags,
  ]);

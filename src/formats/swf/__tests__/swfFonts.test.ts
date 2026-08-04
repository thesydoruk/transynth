import { describe, it, expect } from '@jest/globals';
import { deflateSync } from 'zlib';
import { missingGlyphs, placeholderGlyphs, readSwfFonts } from '../swfFonts';

const FLAG_WIDE_CODES = 0x04;

const tag = (code: number, body: Buffer): Buffer => {
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

/** Build a DefineFont3 body with wide code points and one shape record per glyph. */
const defineFont3 = (
  fontId: number,
  name: string,
  codePoints: number[],
  shapeFor: (codePoint: number, index: number) => Buffer = (_, index) => Buffer.from([0x0f, index]),
): Buffer => {
  const nameBuf = Buffer.from(name, 'utf8');
  const head = Buffer.alloc(5);
  head.writeUInt16LE(fontId, 0);
  head.writeUInt8(FLAG_WIDE_CODES, 2);
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

  return Buffer.concat([head, nameBuf, glyphCount, offsets, ...shapes, codeTable]);
};

const defineFontName = (fontId: number, name: string): Buffer => {
  const id = Buffer.alloc(2);
  id.writeUInt16LE(fontId, 0);
  return Buffer.concat([id, Buffer.from(`${name}\0`, 'utf8'), Buffer.from('\0', 'utf8')]);
};

const buildSwf = (tags: Buffer[], compress = false): Buffer => {
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

const CYRILLIC_I = 0x0456;

describe('readSwfFonts', () => {
  it('decodes font names and code tables', () => {
    const swf = buildSwf([
      tag(75, defineFont3(1, 'Share-TechMono Regular', [0x0041, 0x0438, CYRILLIC_I])),
      tag(88, defineFontName(1, 'Share Tech Mono')),
    ]);

    const fonts = readSwfFonts(swf);

    expect(fonts).toHaveLength(1);
    expect(fonts[0]!.name).toBe('Share-TechMono Regular');
    expect(fonts[0]!.displayName).toBe('Share Tech Mono');
    expect([...fonts[0]!.codePoints].sort((a, b) => a - b)).toEqual([0x0041, 0x0438, CYRILLIC_I]);
  });

  it('reads zlib-compressed CWS libraries', () => {
    const swf = buildSwf([tag(75, defineFont3(7, 'Roboto Condensed', [0x0020, CYRILLIC_I]))], true);

    expect(readSwfFonts(swf)[0]!.codePoints.has(CYRILLIC_I)).toBe(true);
  });

  it('lists several fonts of one library', () => {
    const swf = buildSwf([
      tag(75, defineFont3(1, 'Russian Only', [0x0438, 0x0439])),
      tag(75, defineFont3(2, 'Full Cyrillic', [0x0438, CYRILLIC_I, 0x0457])),
    ]);

    expect(readSwfFonts(swf).map((font) => font.name)).toEqual(['Russian Only', 'Full Cyrillic']);
  });

  it('rejects unsupported signatures', () => {
    expect(() => readSwfFonts(Buffer.from('ZWS\x0f00000000', 'ascii'))).toThrow(/ZWS/);
  });
});

describe('missingGlyphs', () => {
  it('reports Ukrainian letters absent from a Russian-only font', () => {
    const swf = buildSwf([tag(75, defineFont3(1, 'Russian Only', [0x0438, 0x0439, 0x0410]))]);
    const font = readSwfFonts(swf)[0]!;

    expect(missingGlyphs(font, 'іїєґ')).toEqual(['і', 'ї', 'є', 'ґ']);
    expect(missingGlyphs(font, 'Аий')).toEqual([]);
  });
});

describe('placeholderGlyphs', () => {
  const box = Buffer.from([0x01, 0x02, 0x03, 0x04]);
  const boxedCodePoints = [0x0456, 0x0457, 0x0454, 0x0491, 0x2020];

  /** A font that lists Ukrainian letters but draws one shared box for them. */
  const fontWithBoxes = () =>
    readSwfFonts(
      buildSwf([
        tag(
          75,
          defineFont3(1, 'Russian Cyrillic', [0x0438, 0x0410, ...boxedCodePoints], (cp, index) =>
            boxedCodePoints.includes(cp) ? box : Buffer.from([0x0f, index, index]),
          ),
        ),
      ]),
    )[0]!;

  it('flags code points that reuse one outline', () => {
    const found = placeholderGlyphs(fontWithBoxes(), 'іїєґ');

    expect(found.map((glyph) => glyph.char)).toEqual(['і', 'ї', 'є', 'ґ']);
    expect(found[0]!.shapeSize).toBe(box.length);
    expect(found[0]!.sharedWith).toBe(boxedCodePoints.length - 1);
  });

  it('accepts outlines shared by only a couple of look-alike characters', () => {
    const shared = Buffer.from([0x2a, 0x2b]);
    const swf = buildSwf([
      tag(
        75,
        defineFont3(1, 'Look-alikes', [0x0069, 0x0456, 0x0410], (cp, index) =>
          cp === 0x0069 || cp === 0x0456 ? shared : Buffer.from([0x0f, index]),
        ),
      ),
    ]);

    expect(placeholderGlyphs(readSwfFonts(swf)[0]!, 'і')).toEqual([]);
  });
});

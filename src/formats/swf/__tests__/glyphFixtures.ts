/**
 * Synthetic font libraries for the glyph-supply tests.
 *
 * Every glyph is a plain box, so stems, heights and side bearings are known exactly:
 * a box's stem is its width. The donor draws the same Latin boxes as the target —
 * the same design — plus Russian Cyrillic that is taller, wider and raised off the
 * baseline, as the Japanese set's Cyrillic is in Starfield.
 */
import { encodeGlyphShape, type ShapeRecord } from '../glyphShape';
import { buildSwf, defineFont3, tag } from './swfFixtures';

export const TAG_DEFINE_FONT3 = 75;

/** A filled box from `x0` to `x1`, from `top` (negative, up) down to `bottom`. */
export const box = (x0: number, x1: number, top: number, bottom = 0): Buffer =>
  encodeGlyphShape({ fillBits: 1, lineBits: 0, records: boxRecords(x0, x1, top, bottom) });

const boxRecords = (x0: number, x1: number, top: number, bottom: number): ShapeRecord[] => [
  { kind: 'style', move: { x: x0, y: top }, fill1: 1 },
  { kind: 'line', dx: x1 - x0, dy: 0 },
  { kind: 'line', dx: 0, dy: bottom - top },
  { kind: 'line', dx: x0 - x1, dy: 0 },
  { kind: 'line', dx: 0, dy: top - bottom },
];

/** «Г»: a stem and a bar to the right, `stem` thick. */
export const ghe = (x0: number, width: number, height: number, stem: number, foot = 0): Buffer =>
  encodeGlyphShape({
    fillBits: 1,
    lineBits: 0,
    records: [
      { kind: 'style', move: { x: x0, y: foot - height }, fill1: 1 },
      { kind: 'line', dx: width, dy: 0 },
      { kind: 'line', dx: 0, dy: stem },
      { kind: 'line', dx: stem - width, dy: 0 },
      { kind: 'line', dx: 0, dy: height - stem },
      { kind: 'line', dx: -stem, dy: 0 },
    ],
  });

export type Glyph = { shape: Buffer; advance: number };

export const LATIN_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const LATIN_LOWER = 'abcdefghijklmnopqrstuvwxyz';
export const CAP_HEIGHT = 700;
export const X_HEIGHT = 500;

/** Latin letters, digits and the punctuation the recipes copy from; `widen` stretches every box. */
export const latinGlyphs = (widen = 1, unicase = false): Record<string, Glyph> => {
  const glyphs: Record<string, Glyph> = {};
  [...LATIN_UPPER].forEach((char, i) => {
    const width = Math.round((300 + i * 4) * widen);
    glyphs[char] = { shape: box(60, 60 + width, -CAP_HEIGHT), advance: width + 120 };
  });
  [...LATIN_LOWER].forEach((char, i) => {
    const width = Math.round((240 + i * 3) * widen);
    glyphs[char] = unicase
      ? glyphs[char.toUpperCase()]!
      : { shape: box(50, 50 + width, -X_HEIGHT), advance: width + 100 };
  });
  for (const digit of '0123456789') {
    glyphs[digit] = { shape: box(50, 50 + 280 * widen, -CAP_HEIGHT), advance: 380 };
  }
  glyphs['Ï'] = { shape: box(60, 140, -900), advance: 200 };
  glyphs['ï'] = { shape: box(50, 110, -700), advance: 160 };
  glyphs['’'] = { shape: box(40, 90, -700, -550), advance: 130 };
  glyphs["'"] = { shape: box(40, 90, -700, -550), advance: 130 };
  glyphs['-'] = { shape: box(40, 240, -300, -240), advance: 280 };
  glyphs['.'] = { shape: box(40, 110, -70), advance: 150 };
  glyphs['«'] = { shape: box(40, 400, -400, -100), advance: 440 };
  glyphs['»'] = { shape: box(40, 400, -400, -100), advance: 440 };
  return glyphs;
};

const RUSSIAN_UPPER = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';

/** Russian Cyrillic as the Japanese set draws it: 10 % taller, wider, 20 units up. */
export const russianGlyphs = (): Record<string, Glyph> => {
  const glyphs: Record<string, Glyph> = {};
  // Each letter a little wider than the last, so no outline is shared like a placeholder box.
  [...RUSSIAN_UPPER].forEach((char, i) => {
    glyphs[char] = { shape: box(200, 640 + i * 4, -790, -20), advance: 1024 };
    glyphs[char.toLowerCase()] = { shape: box(220, 560 + i * 4, -570, -20), advance: 1024 };
  });
  // «Б» as wide as «Н», so a test can tell the fitted stem from the box width.
  glyphs['Б'] = glyphs['Н']!;
  glyphs['Г'] = { shape: ghe(200, 440, 770, 110, -20), advance: 1024 };
  glyphs['г'] = { shape: ghe(220, 340, 550, 85, -20), advance: 1024 };
  glyphs['№'] = { shape: box(100, 900, -790, -20), advance: 1024 };
  return glyphs;
};

/** A DefineFont3 tag drawing the given glyphs, in code point order. */
export const fontTag = (fontId: number, name: string, glyphs: Record<string, Glyph>): Buffer => {
  const chars = Object.keys(glyphs).sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
  return tag(
    TAG_DEFINE_FONT3,
    defineFont3(
      fontId,
      name,
      chars.map((c) => c.codePointAt(0)!),
      {
        shapeFor: (_, i) => glyphs[chars[i]!]!.shape,
        advances: chars.map((c) => glyphs[c]!.advance),
        ascent: 1000,
      },
    ),
  );
};

/** An align-zones tag with one empty zone record per glyph. */
export const alignZonesTag = (fontId: number, glyphCount: number): Buffer => {
  const head = Buffer.alloc(3);
  head.writeUInt16LE(fontId, 0);
  const record = Buffer.from([0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0x03]);
  return tag(73, Buffer.concat([head, ...Array.from({ length: glyphCount }, () => record)]));
};

/** The Japanese-style donor library: same Latin, plus Russian Cyrillic. */
export const donorLibrary = (name = 'JP Sans'): Buffer =>
  buildSwf([fontTag(1, name, { ...latinGlyphs(), ...russianGlyphs() })]);

/** Re-sign a library as Scaleform's `GFX`. */
export const asGfx = (swf: Buffer): Buffer => {
  const copy = Buffer.from(swf);
  copy.write('GFX', 0, 3, 'ascii');
  return copy;
};

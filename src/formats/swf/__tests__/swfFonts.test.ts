import { describe, it, expect } from '@jest/globals';
import { missingGlyphs, placeholderGlyphs, readSwfFonts } from '../swfFonts';
import { buildSwf, defineFont3, defineFontName, tag } from './swfFixtures';

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
  const boxedCodePoints = [
    0x0456,
    0x0457,
    0x0454,
    0x0491,
    0x2020,
    ...Array.from({ length: 15 }, (_, i) => 0x0400 + i),
  ];

  /** A font that lists Ukrainian letters but draws one shared box for them. */
  const fontWithBoxes = () =>
    readSwfFonts(
      buildSwf([
        tag(
          75,
          defineFont3(1, 'Russian Cyrillic', [0x0438, 0x0410, ...boxedCodePoints], {
            shapeFor: (cp, index) =>
              boxedCodePoints.includes(cp) ? box : Buffer.from([0x0f, index, index]),
          }),
        ),
      ]),
    )[0]!;

  it('flags code points that reuse one outline', () => {
    const found = placeholderGlyphs(fontWithBoxes(), 'іїєґ');

    expect(found.map((glyph) => glyph.char)).toEqual(['і', 'ї', 'є', 'ґ']);
    expect(found[0]!.shapeSize).toBe(box.length);
    expect(found[0]!.sharedWith).toBe(boxedCodePoints.length - 1);
  });

  it('accepts an outline shared by a cluster of look-alike characters', () => {
    const shared = Buffer.from([0x2a, 0x2b]);
    // Cyrillic І, Latin I, Greek Ι, the Roman numeral and the fullwidth form.
    const lookAlikes = [0x0406, 0x0049, 0x0399, 0x2160, 0xff29];
    const swf = buildSwf([
      tag(
        75,
        defineFont3(1, 'Look-alikes', [...lookAlikes, 0x0410, 0x0411], {
          shapeFor: (cp, index) => (lookAlikes.includes(cp) ? shared : Buffer.from([0x0f, index])),
        }),
      ),
    ]);

    expect(placeholderGlyphs(readSwfFonts(swf)[0]!, 'І')).toEqual([]);
  });
});

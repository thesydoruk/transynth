/**
 * String tables as the games ship them: the English tables of Fallout 4 and
 * Starfield hold Windows-1252 bytes, a translated table holds UTF-8.
 */
import { describe, it, expect } from '@jest/globals';
import { parseStringsBuffer, writeStringsBuffer, type StringsType } from '..';

/** A table built from raw payload bytes, so the test controls the encoding. */
const rawTable = (type: StringsType, payloads: Array<[number, Buffer]>): Buffer => {
  const directory = Buffer.alloc(8 + payloads.length * 8);
  const blobParts: Buffer[] = [];
  let offset = 0;
  payloads.forEach(([id, bytes], i) => {
    const text = Buffer.concat([bytes, Buffer.from([0])]);
    directory.writeUInt32LE(id, 8 + i * 8);
    directory.writeUInt32LE(offset, 12 + i * 8);
    if (type !== 'STRINGS') {
      const length = Buffer.alloc(4);
      length.writeUInt32LE(text.length, 0);
      blobParts.push(length);
      offset += 4;
    }
    blobParts.push(text);
    offset += text.length;
  });
  directory.writeUInt32LE(payloads.length, 0);
  directory.writeUInt32LE(offset, 4);
  return Buffer.concat([directory, ...blobParts]);
};

const cp1252 = (text: string): Buffer => Buffer.from(text, 'latin1');

/** Lines of the Starfield English tables, as their bytes are on disk. */
const WINDOWS_1252_LINES: Array<[number, Buffer, string]> = [
  [1, cp1252('Touch\xe9.'), 'Touché.'],
  [2, cp1252('Admiral Fran\xe7ois Sanon'), 'Admiral François Sanon'],
  [3, cp1252("\xc0 tout \xe0 l'heure."), "À tout à l'heure."],
  [4, cp1252('Ayumi Komiko\x92s whereabouts'), 'Ayumi Komiko’s whereabouts'],
  [5, cp1252('TODAY\x92S LESSON \x96 K8s'), 'TODAY’S LESSON – K8s'],
];

describe.each<StringsType>(['STRINGS', 'DLSTRINGS', 'ILSTRINGS'])('%s encoding', (type) => {
  it('reads Windows-1252 text with its accented letters and apostrophes', () => {
    const table = rawTable(
      type,
      WINDOWS_1252_LINES.map(([id, bytes]) => [id, bytes]),
    );
    const parsed = parseStringsBuffer(table, type);
    for (const [id, , text] of WINDOWS_1252_LINES) expect(parsed.get(id)).toBe(text);
  });

  it('leaves valid UTF-8 text as it is, next to Windows-1252 lines', () => {
    const utf8Lines = ['Привіт, Wasteland!', 'Café “Prime” — 5 ₴', 'broken � glyph'];
    const table = rawTable(type, [
      ...utf8Lines.map((text, i): [number, Buffer] => [10 + i, Buffer.from(text, 'utf8')]),
      [20, cp1252('prot\xe9g\xe9')],
    ]);
    const parsed = parseStringsBuffer(table, type);
    utf8Lines.forEach((text, i) => expect(parsed.get(10 + i)).toBe(text));
    expect(parsed.get(20)).toBe('protégé');
  });

  it('writes what it read as UTF-8', () => {
    const parsed = parseStringsBuffer(rawTable(type, [[1, cp1252('d\xe9j\xe0 vu')]]), type);
    const written = parseStringsBuffer(writeStringsBuffer(parsed, type), type);
    expect(written.get(1)).toBe('déjà vu');
  });
});

import { describe, it, expect } from '@jest/globals';
import { parseStringsBuffer, writeStringsBuffer, stringsTypeFromPath, type StringsType } from '..';

describe('stringsTypeFromPath', () => {
  it('detects STRINGS', () => {
    expect(stringsTypeFromPath('Strings\\Mod_en.STRINGS')).toBe('STRINGS');
  });
  it('detects DLSTRINGS (case-insensitive)', () => {
    expect(stringsTypeFromPath('/path/to/Mod_ru.dlstrings')).toBe('DLSTRINGS');
  });
  it('detects ILSTRINGS', () => {
    expect(stringsTypeFromPath('Mod_fr.ILSTRINGS')).toBe('ILSTRINGS');
  });
  it('defaults to STRINGS for unknown extension', () => {
    expect(stringsTypeFromPath('Mod.txt')).toBe('STRINGS');
  });
});

const roundTrip = (entries: Map<number, string>, type: StringsType): Map<number, string> => {
  const buf = writeStringsBuffer(entries, type);
  return parseStringsBuffer(buf, type);
};

describe('STRINGS round-trip', () => {
  const input = new Map<number, string>([
    [1, 'Hello'],
    [2, 'World'],
    [42, 'Fallout 4'],
  ]);

  it('preserves all entries', () => {
    const result = roundTrip(input, 'STRINGS');
    expect(result.size).toBe(3);
    expect(result.get(1)).toBe('Hello');
    expect(result.get(2)).toBe('World');
    expect(result.get(42)).toBe('Fallout 4');
  });

  it('handles empty map', () => {
    const result = roundTrip(new Map(), 'STRINGS');
    expect(result.size).toBe(0);
  });

  it('handles non-ASCII UTF-8 text (Ukrainian)', () => {
    const ua = new Map<number, string>([[1, 'Привіт, Wasteland!']]);
    const result = roundTrip(ua, 'STRINGS');
    expect(result.get(1)).toBe('Привіт, Wasteland!');
  });

  it('preserves text with special characters', () => {
    const special = new Map<number, string>([[10, 'He said "Hello" & <stayed>.']]);
    const result = roundTrip(special, 'STRINGS');
    expect(result.get(10)).toBe('He said "Hello" & <stayed>.');
  });
});

describe('DLSTRINGS round-trip', () => {
  const input = new Map<number, string>([
    [100, 'A short description.'],
    [200, 'A longer description with\nnewlines and "quotes".'],
  ]);

  it('preserves all entries', () => {
    const result = roundTrip(input, 'DLSTRINGS');
    expect(result.size).toBe(2);
    expect(result.get(100)).toBe('A short description.');
    expect(result.get(200)).toBe('A longer description with\nnewlines and "quotes".');
  });

  it('handles empty map', () => {
    const result = roundTrip(new Map(), 'DLSTRINGS');
    expect(result.size).toBe(0);
  });
});

describe('ILSTRINGS round-trip', () => {
  it('preserves dialogue text', () => {
    const input = new Map<number, string>([
      [1001, 'War. War never changes.'],
      [1002, 'I used to be an adventurer like you.'],
    ]);
    const result = roundTrip(input, 'ILSTRINGS');
    expect(result.get(1001)).toBe('War. War never changes.');
    expect(result.get(1002)).toBe('I used to be an adventurer like you.');
  });
});

describe('writeStringsBuffer header', () => {
  it('writes correct count in header', () => {
    const map = new Map<number, string>([
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
    ]);
    const buf = writeStringsBuffer(map, 'STRINGS');
    expect(buf.readUInt32LE(0)).toBe(3);
  });

  it('dataSize matches actual blob length', () => {
    const map = new Map<number, string>([[7, 'test']]);
    const buf = writeStringsBuffer(map, 'STRINGS');
    const count = buf.readUInt32LE(0);
    const dataSize = buf.readUInt32LE(4);
    const headerSize = 8 + count * 8;
    expect(buf.length - headerSize).toBe(dataSize);
  });

  it('DLSTRINGS dataSize includes 4-byte length prefix per entry', () => {
    const map = new Map<number, string>([[1, 'xyz']]);
    const buf = writeStringsBuffer(map, 'DLSTRINGS');
    const dataSize = buf.readUInt32LE(4);
    expect(dataSize).toBe(4 + 4);
  });
});

describe('large map round-trip', () => {
  it('round-trips 1000 STRINGS entries', () => {
    const input = new Map<number, string>();
    for (let i = 1; i <= 1000; i++) input.set(i, `String number ${i}`);

    const result = roundTrip(input, 'STRINGS');
    expect(result.size).toBe(1000);
    for (const [id, text] of input) {
      expect(result.get(id)).toBe(text);
    }
  });
});

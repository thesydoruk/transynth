import { describe, expect, it } from '@jest/globals';
import {
  W3STRINGS_UTF8_VERSION,
  decodeW3Strings,
  encodeW3Strings,
  readW3Vlq,
  w3KeyHash,
  writeW3Vlq,
  type W3StringsEntry,
} from '../w3strings';

// Values below were read from tables written by rmemr's `w3strings.exe`.
describe('w3KeyHash', () => {
  it('hashes the lowercased key name', () => {
    expect(w3KeyHash('panel_mods')).toBe(0x4d5f8b0c);
    expect(w3KeyHash('panel_Mods')).toBe(0x4d5f8b0c);
  });
});

describe('VLQ counts', () => {
  it.each([
    [30, [0x1e]],
    [253, [0x7d, 0x03]],
    [27712, [0x40, 0xb1, 0x03]],
    [2441787, [0x7b, 0x88, 0xaa, 0x02]],
  ])('writes and reads %i as the encoder does', (value, bytes) => {
    expect([...writeW3Vlq(value)]).toEqual(bytes);
    expect(readW3Vlq(Buffer.from(bytes), 0)).toEqual({ value, next: bytes.length });
  });

  it('writes zero as 0x80 and reads it back', () => {
    expect([...writeW3Vlq(0)]).toEqual([0x80]);
    expect(readW3Vlq(Buffer.from([0x80]), 0).value).toBe(0);
  });

  it('round-trips a value with an empty middle group', () => {
    expect(readW3Vlq(writeW3Vlq(8192), 0).value).toBe(8192);
  });
});

const sample: W3StringsEntry[] = [
  { id: 2119001000, keyHash: w3KeyHash('panel_mods'), text: 'Mods' },
  { id: 466292, keyHash: 0xc02c3cd2, text: 'Guard' },
  { id: 1008713, keyHash: 0, text: 'Good day!' },
  { id: 97959, keyHash: 0, text: '' },
  { id: 1229726, keyHash: 0, text: 'Ґеральт: «Хм.»<br>Wind’s howling. 😀' },
];

describe('encodeW3Strings / decodeW3Strings', () => {
  it.each([
    ['en', 162],
    ['pl', 162],
    ['ua', 162],
    ['en', W3STRINGS_UTF8_VERSION],
    ['ua', W3STRINGS_UTF8_VERSION],
  ])('round-trips a %s table at version %i', (lang, version) => {
    const decoded = decodeW3Strings(encodeW3Strings(sample, lang, { version }));
    expect(decoded.version).toBe(version);
    expect(decoded.entries).toEqual(sample);
  });

  it('sizes a UTF-16 table the way the reference encoder does', () => {
    // header 10, three counts, 12 per index row, 8 per keyed row, units + terminators, footer 2.
    const rows = sample.map((entry, i) => ({ ...entry, keyHash: i < 2 ? entry.keyHash : 0 }));
    const units = rows.reduce(
      (sum, row) => sum + Buffer.from(row.text, 'utf16le').length / 2 + 1,
      0,
    );
    const buf = encodeW3Strings(rows, 'en');
    expect(buf.length).toBe(
      10 + 1 + rows.length * 12 + 1 + 2 * 8 + writeW3Vlq(units).length + units * 2 + 2,
    );
  });

  it('obfuscates ids and text for a keyed language, not for a cleartext one', () => {
    const en = encodeW3Strings(sample, 'en');
    const ua = encodeW3Strings(sample, 'ua');
    expect(en.includes(Buffer.from('Guard', 'utf16le'))).toBe(false);
    expect(ua.includes(Buffer.from('Guard', 'utf16le'))).toBe(true);
    expect(en.readUInt16LE(8)).toBe(0x4397);
    expect(en.readUInt16LE(en.length - 2)).toBe(0x5139);
  });

  it('sorts the index by stored id and the keys by hash, as the game binary-searches them', () => {
    const buf = encodeW3Strings(sample, 'en');
    const stored: number[] = [];
    for (let i = 0; i < sample.length; i++) stored.push(buf.readUInt32LE(11 + i * 12));
    expect(stored).toEqual([...stored].sort((a, b) => a - b));

    const keyStart = 11 + sample.length * 12 + 1;
    const hashes = [buf.readUInt32LE(keyStart), buf.readUInt32LE(keyStart + 8)];
    expect(hashes).toEqual([...hashes].sort((a, b) => a - b));
  });

  it('reads UTF-8 data from a table that declares an older version', () => {
    const utf8 = encodeW3Strings(sample, 'ua', { version: W3STRINGS_UTF8_VERSION });
    utf8.writeUInt32LE(162, 4);
    expect(decodeW3Strings(utf8).entries).toEqual(sample);
  });

  it('keeps key rows for ids the table does not hold', () => {
    const foreignKeys = [{ keyHash: w3KeyHash('menu_elsewhere'), id: 555 }];
    const buf = encodeW3Strings(sample, 'en', { foreignKeys });
    const decoded = decodeW3Strings(buf);
    expect(decoded.foreignKeys).toEqual(foreignKeys);
    expect(encodeW3Strings(decoded.entries, 'en', { foreignKeys: decoded.foreignKeys })).toEqual(
      buf,
    );
  });

  it('rejects files that are not string tables', () => {
    expect(() => decodeW3Strings(Buffer.from('CPSW0000000000'))).toThrow(/RTSW/);
  });
});

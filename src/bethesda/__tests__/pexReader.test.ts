/**
 * Unit tests for compiled Papyrus script (.pex) parser.
 */
import { describe, it, expect } from '@jest/globals';
import { parsePexBuffer, isLikelyUserText } from '../pex';

const writeWString = (buf: Buffer, offset: number, s: string): number => {
  const bytes = Buffer.from(s, 'utf8');
  buf.writeUInt16BE(bytes.length, offset);
  bytes.copy(buf, offset + 2);
  return offset + 2 + bytes.length;
};

const buildPex = (strings: string[], opts?: { sourceFile?: string; gameId?: number }): Buffer => {
  const sourceFile = opts?.sourceFile ?? 'TestScript.psc';
  const gameId = opts?.gameId ?? 3;

  const wsize = (s: string) => 2 + Buffer.byteLength(s, 'utf8');
  const totalSize =
    16 +
    wsize(sourceFile) +
    wsize('testuser') +
    wsize('testmachine') +
    2 +
    strings.reduce((acc, s) => acc + wsize(s), 0);

  const buf = Buffer.alloc(totalSize, 0);
  let pos = 0;

  buf.writeUInt32BE(0xfa57c0de, pos); pos += 4;
  buf.writeUInt8(3, pos); pos += 1;
  buf.writeUInt8(2, pos); pos += 1;
  buf.writeUInt16BE(gameId, pos); pos += 2;
  pos += 8;

  pos = writeWString(buf, pos, sourceFile);
  pos = writeWString(buf, pos, 'testuser');
  pos = writeWString(buf, pos, 'testmachine');

  buf.writeUInt16BE(strings.length, pos); pos += 2;
  for (const s of strings) {
    pos = writeWString(buf, pos, s);
  }

  return buf;
};

describe('parsePexBuffer — header parsing', () => {
  it('reads sourceFile, gameId, and version from header', () => {
    const buf = buildPex([], { sourceFile: 'MyCoolScript.psc', gameId: 3 });
    const result = parsePexBuffer(buf);
    expect(result.info.sourceFile).toBe('MyCoolScript.psc');
    expect(result.info.gameId).toBe(3);
    expect(result.info.version).toBe('3.2');
  });

  it('returns empty strings array for empty string table', () => {
    const buf = buildPex([]);
    const result = parsePexBuffer(buf);
    expect(result.strings).toEqual([]);
  });

  it('throws on bad magic', () => {
    const buf = buildPex([]);
    buf.writeUInt32BE(0xdeadbeef, 0);
    expect(() => parsePexBuffer(buf)).toThrow(/invalid magic/i);
  });

  it('throws on buffer too small', () => {
    const buf = Buffer.alloc(10);
    expect(() => parsePexBuffer(buf)).toThrow(/too small/i);
  });
});

describe('parsePexBuffer — string table filtering', () => {
  it('extracts user-visible strings from mixed string table', () => {
    const strings = [
      'ActorValue',
      'TriggerSystemScript',
      'GetActorValue',
      'None',
      'You have been detected!',
      'Power Armor removed.',
      'Bool',
      'akTarget',
    ];
    const result = parsePexBuffer(buildPex(strings));
    expect(result.strings).toContain('You have been detected!');
    expect(result.strings).toContain('Power Armor removed.');
    expect(result.strings).not.toContain('ActorValue');
    expect(result.strings).not.toContain('TriggerSystemScript');
    expect(result.strings).not.toContain('None');
    expect(result.strings).not.toContain('akTarget');
  });

  it('keeps strings with exclamation or question marks', () => {
    const strings = ['Warning!', 'AreYouSure?', 'SomeName'];
    const result = parsePexBuffer(buildPex(strings));
    expect(result.strings).toContain('Warning!');
    expect(result.strings).toContain('AreYouSure?');
    expect(result.strings).not.toContain('SomeName');
  });

  it('keeps strings with commas when long enough', () => {
    const strings = ['Value1,Value2,Value3', 'A,B'];
    const result = parsePexBuffer(buildPex(strings));
    expect(result.strings).toContain('Value1,Value2,Value3');
    expect(result.strings).not.toContain('A,B');
  });

  it('returns only unique entries (no deduplication needed — keeps all matching)', () => {
    const strings = ['Quest started.', 'Quest started.'];
    const result = parsePexBuffer(buildPex(strings));
    expect(result.strings.length).toBe(2);
  });

  it('handles a script with only identifiers — returns empty strings', () => {
    const strings = ['TriggerScript', 'OnInit', 'akTarget', 'None', 'Bool', 'Int'];
    const result = parsePexBuffer(buildPex(strings));
    expect(result.strings).toEqual([]);
  });
});

describe('parsePexBuffer — UTF-8 / encoding', () => {
  it('handles multi-byte UTF-8 (Cyrillic) string literals', () => {
    const strings = ['Завдання виконано!', 'CyrillicIdentifier'];
    const result = parsePexBuffer(buildPex(strings));
    expect(result.strings).toContain('Завдання виконано!');
  });

  it('handles Skyrim gameId (1) the same way as FO4', () => {
    const strings = ['Quest marker set.'];
    const result = parsePexBuffer(buildPex(strings, { gameId: 1 }));
    expect(result.info.gameId).toBe(1);
    expect(result.strings).toContain('Quest marker set.');
  });
});

describe('isLikelyUserText', () => {
  it('returns false for empty string', () => {
    expect(isLikelyUserText('')).toBe(false);
  });

  it('returns false for strings shorter than 3 characters', () => {
    expect(isLikelyUserText('AB')).toBe(false);
    expect(isLikelyUserText('a')).toBe(false);
  });

  it('returns true for strings with whitespace', () => {
    expect(isLikelyUserText('hello world')).toBe(true);
    expect(isLikelyUserText('turn left')).toBe(true);
  });

  it('returns false for pure identifiers without punctuation', () => {
    expect(isLikelyUserText('TriggerScript')).toBe(false);
    expect(isLikelyUserText('GetActorValue')).toBe(false);
    expect(isLikelyUserText('akTarget')).toBe(false);
    expect(isLikelyUserText('None')).toBe(false);
    expect(isLikelyUserText('Bool')).toBe(false);
  });

  it('returns true for strings with !', () => {
    expect(isLikelyUserText('Warning!')).toBe(true);
    expect(isLikelyUserText('Done!')).toBe(true);
  });

  it('returns true for strings with ?', () => {
    expect(isLikelyUserText('IsActive?')).toBe(true);
    expect(isLikelyUserText('Sure?')).toBe(true);
  });

  it('returns true for long strings with commas', () => {
    expect(isLikelyUserText('Apples, Pears, Oranges')).toBe(true);
    expect(isLikelyUserText('ItemA,ItemB,ItemC')).toBe(true);
  });

  it('returns false for short comma-separated strings (< 6 chars)', () => {
    expect(isLikelyUserText('A,B')).toBe(false);
  });

  it('returns true for Cyrillic text with spaces', () => {
    expect(isLikelyUserText('Гравець знайдений')).toBe(true);
  });
});
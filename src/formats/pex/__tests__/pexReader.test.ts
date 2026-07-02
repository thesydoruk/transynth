/**
 * Unit tests for compiled Papyrus script (.pex) parser.
 */
import { describe, it, expect } from '@jest/globals';
import { parsePexBuffer, isLikelyUserText, patchPexBuffer, formatPexStringContext } from '..';

const writeWString = (buf: Buffer, offset: number, s: string): number => {
  const bytes = Buffer.from(s, 'utf8');
  buf.writeUInt16BE(bytes.length, offset);
  bytes.copy(buf, offset + 2);
  return offset + 2 + bytes.length;
};

const buildPex = (
  strings: string[],
  opts?: { sourceFile?: string; gameId?: number; endian?: 'be' | 'le' },
): Buffer => {
  const sourceFile = opts?.sourceFile ?? 'TestScript.psc';
  const gameId = opts?.gameId ?? 3;
  const endian = opts?.endian ?? 'be';

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

  if (endian === 'le') buf.writeUInt32LE(0xfa57c0de, pos);
  else buf.writeUInt32BE(0xfa57c0de, pos);
  pos += 4;
  buf.writeUInt8(3, pos);
  pos += 1;
  buf.writeUInt8(2, pos);
  pos += 1;
  if (endian === 'le') buf.writeUInt16LE(gameId, pos);
  else buf.writeUInt16BE(gameId, pos);
  pos += 2;
  pos += 8;

  const writeW = (s: string) => {
    const bytes = Buffer.from(s, 'utf8');
    if (endian === 'le') buf.writeUInt16LE(bytes.length, pos);
    else buf.writeUInt16BE(bytes.length, pos);
    bytes.copy(buf, pos + 2);
    pos += 2 + bytes.length;
  };

  writeW(sourceFile);
  writeW('testuser');
  writeW('testmachine');

  if (endian === 'le') buf.writeUInt16LE(strings.length, pos);
  else buf.writeUInt16BE(strings.length, pos);
  pos += 2;
  for (const s of strings) writeW(s);

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

  it('parses little-endian Fallout 4 CK output', () => {
    const strings = ['Hello from layer script', 'TriggerScript', 'Done!'];
    const result = parsePexBuffer(
      buildPex(strings, { endian: 'le', sourceFile: 'LayerScript.psc' }),
    );
    expect(result.info.sourceFile).toBe('LayerScript.psc');
    expect(result.strings).toEqual(['Hello from layer script', 'Done!']);
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

describe('patchPexBuffer', () => {
  it('replaces mapped string-table entries and preserves tail bytes', () => {
    const tailMarker = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const strings = ['ActorValue', 'Hello world', 'GetActorValue'];
    const source = Buffer.concat([
      buildPex(strings, { sourceFile: 'DialogScript.psc' }),
      tailMarker,
    ]);
    const overlay = new Map([['Hello world', 'Привіт, світ']]);

    const patched = patchPexBuffer(source, overlay);
    const parsed = parsePexBuffer(patched);

    expect(parsed.info.sourceFile).toBe('DialogScript.psc');
    expect(parsed.strings).toContain('Привіт, світ');
    expect(parsed.strings).not.toContain('Hello world');
    expect(patched.subarray(patched.length - tailMarker.length).equals(tailMarker)).toBe(true);
  });

  it('returns the original buffer when overlay is empty', () => {
    const source = buildPex(['Hello world']);
    expect(patchPexBuffer(source, new Map())).toBe(source);
  });

  it('falls back to source text for unmapped user-visible strings', () => {
    const strings = ['First message', 'Second message'];
    const source = buildPex(strings, { sourceFile: 'QuestScript.psc' });
    const overlay = new Map([['First message', 'Перше повідомлення']]);

    const parsed = parsePexBuffer(patchPexBuffer(source, overlay));
    expect(parsed.strings).toEqual(['Перше повідомлення', 'Second message']);
  });

  it('preserves little-endian layout when patching', () => {
    const strings = ['Hello world', 'ActorValue'];
    const source = buildPex(strings, { sourceFile: 'DialogScript.psc', endian: 'le' });
    const overlay = new Map([['Hello world', 'Привіт, світ']]);
    const patched = patchPexBuffer(source, overlay);
    expect(patched.readUInt32LE(0)).toBe(0xfa57c0de);
    const parsed = parsePexBuffer(patched);
    expect(parsed.strings).toContain('Привіт, світ');
  });
});

const appendLeU8 = (chunks: Buffer[], value: number): void => {
  const b = Buffer.alloc(1);
  b.writeUInt8(value, 0);
  chunks.push(b);
};

const appendLeU16 = (chunks: Buffer[], value: number): void => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value, 0);
  chunks.push(b);
};

const appendLeU32 = (chunks: Buffer[], value: number): void => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value, 0);
  chunks.push(b);
};

const appendVarString = (chunks: Buffer[], tableIndex: number): void => {
  appendLeU8(chunks, 0x02);
  appendLeU16(chunks, tableIndex);
};

const appendVarIdentifier = (chunks: Buffer[], tableIndex: number): void => {
  appendLeU8(chunks, 0x01);
  appendLeU16(chunks, tableIndex);
};

const buildPexWithAssignLiteral = (): Buffer => {
  const strings = [
    'WorkshopScript',
    '',
    '',
    'auto',
    'OnInit',
    'None',
    '',
    'Built workshop ready!',
    'messageVar',
  ];
  const header = buildPex(strings, { sourceFile: 'WorkshopScript.psc', gameId: 3, endian: 'le' });
  const tail: Buffer[] = [];

  appendLeU8(tail, 0); // no debug info
  appendLeU16(tail, 0); // user flags

  appendLeU16(tail, 1); // one object
  appendLeU16(tail, 0); // object name
  appendLeU32(tail, 0); // object size (ignored)
  appendLeU16(tail, 1); // parent
  appendLeU16(tail, 2); // doc
  appendLeU8(tail, 0); // FO4 const flag
  appendLeU32(tail, 0); // user flags
  appendLeU16(tail, 3); // auto state
  appendLeU16(tail, 0); // structs
  appendLeU16(tail, 0); // variables
  appendLeU16(tail, 0); // properties
  appendLeU16(tail, 1); // states
  appendLeU16(tail, 3); // state name
  appendLeU16(tail, 1); // functions
  appendLeU16(tail, 4); // function name
  appendLeU16(tail, 5); // return type
  appendLeU16(tail, 6); // doc
  appendLeU32(tail, 0);
  appendLeU8(tail, 0);
  appendLeU16(tail, 0); // params
  appendLeU16(tail, 0); // locals
  appendLeU16(tail, 1); // one instruction
  appendLeU8(tail, 0x0d); // assign
  appendVarIdentifier(tail, 8);
  appendVarString(tail, 7);

  return Buffer.concat([header, ...tail]);
};

describe('parsePexBuffer — bytecode usage', () => {
  it('maps translatable literals to owning functions', () => {
    const result = parsePexBuffer(buildPexWithAssignLiteral());
    expect(result.userStrings).toHaveLength(1);
    expect(result.userStrings[0]).toMatchObject({
      text: 'Built workshop ready!',
      literalIndex: 1,
      usages: [
        expect.objectContaining({
          objectName: 'WorkshopScript',
          functionName: 'OnInit',
          kind: 'function',
          opcode: 'assign',
        }),
      ],
    });
  });
});

describe('formatPexStringContext', () => {
  it('formats source file and literal index when usage is unknown', () => {
    expect(formatPexStringContext('LayerScript.psc', { literalIndex: 3, usages: [] })).toBe(
      'LayerScript.psc · #3',
    );
    expect(formatPexStringContext('LayerScript', { literalIndex: 1, usages: [] })).toBe(
      'LayerScript.psc · #1',
    );
  });

  it('includes function and call target when bytecode usage is known', () => {
    expect(
      formatPexStringContext('WorkshopScript.psc', {
        literalIndex: 1,
        usages: [
          {
            objectName: 'WorkshopScript',
            stateName: 'auto',
            functionName: 'OnInit',
            kind: 'function',
            opcode: 'callstatic',
            usageHint: 'Debug.Trace',
            lineNumber: 42,
          },
        ],
      }),
    ).toBe('WorkshopScript.psc · OnInit() · Debug.Trace · line 42');
  });
});

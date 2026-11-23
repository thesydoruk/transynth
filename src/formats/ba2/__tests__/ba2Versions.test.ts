import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { Ba2Reader, writeBa2, writeBa2File } from '..';

const tempDirs: string[] = [];
const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'formats-ba2-ver-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

const FIXED_INPUT = [
  { name: 'Strings\\A_en.STRINGS', data: Buffer.from('hello strings') },
  { name: 'Scripts/B.pex', data: Buffer.alloc(500, 7), compressed: true },
  { name: 'interface/translate_en.txt', data: Buffer.from('x'.repeat(2000)), compressed: true },
];

/** sha256 of `writeBa2(FIXED_INPUT)` taken from the code before version support existed. */
const V1_BASELINE_SHA256 = '7ef64f9942639aa0b6c963f6f23e0b5b649780d20549912637801ad68f39e7eb';

const sha256 = (buf: Buffer): string => crypto.createHash('sha256').update(buf).digest('hex');

const openBuffer = (buf: Buffer): Ba2Reader => {
  const file = path.join(tempDir(), 'x.ba2');
  fs.writeFileSync(file, buf);
  return new Ba2Reader(file);
};

describe('BA2 version 1 output', () => {
  it('is byte-identical to what the writer produced before versions existed', () => {
    expect(sha256(writeBa2(FIXED_INPUT))).toBe(V1_BASELINE_SHA256);
    expect(sha256(writeBa2(FIXED_INPUT, 1))).toBe(V1_BASELINE_SHA256);
  });

  it('has a 24-byte header and reports version 1', () => {
    const buf = writeBa2(FIXED_INPUT);
    expect(buf.readUInt32LE(4)).toBe(1);
    expect(openBuffer(buf).version).toBe(1);
  });
});

describe('BA2 version 2 (Starfield GNRL)', () => {
  it('writes a 32-byte header with uint64 1 after the name table offset', () => {
    const buf = writeBa2(FIXED_INPUT, 2);
    expect(buf.toString('ascii', 0, 4)).toBe('BTDX');
    expect(buf.readUInt32LE(4)).toBe(2);
    expect(buf.toString('ascii', 8, 12)).toBe('GNRL');
    expect(buf.readUInt32LE(12)).toBe(3);
    expect(buf.readBigUInt64LE(24)).toBe(1n);
    // first entry starts right after the 32-byte header
    expect(buf.readBigUInt64LE(32 + 16)).toBe(BigInt(32 + 3 * 36));
  });

  it('differs from version 1 only by header, shifted offsets and the version field', () => {
    const v1 = writeBa2(FIXED_INPUT);
    const v2 = writeBa2(FIXED_INPUT, 2);
    expect(v2.length).toBe(v1.length + 8);
    expect(v2.subarray(32 + 3 * 36)).toEqual(v1.subarray(24 + 3 * 36));
  });

  it('reads back compressed and uncompressed entries by name', () => {
    const reader = openBuffer(writeBa2(FIXED_INPUT, 2));
    expect(reader.version).toBe(2);
    expect(reader.fileCount).toBe(3);
    expect(reader.extractByName('strings/a_en.strings')?.toString()).toBe('hello strings');
    expect(reader.extractByName('Scripts\\B.pex')).toEqual(Buffer.alloc(500, 7));
    expect(reader.extractByName('INTERFACE/translate_en.txt')?.toString()).toBe('x'.repeat(2000));
    const packed = reader.listEntries().find((e) => e.name.endsWith('.pex'))!;
    expect(packed.packedSize).toBeGreaterThan(0);
    reader.close();
  });

  it('writeBa2 to a path and writeBa2File match the in-memory archive', async () => {
    const dir = tempDir();
    const memory = writeBa2(FIXED_INPUT, 2);
    const syncPath = path.join(dir, 'sync.ba2');
    const asyncPath = path.join(dir, 'async.ba2');
    writeBa2(FIXED_INPUT, syncPath, 2);
    await writeBa2File(FIXED_INPUT, asyncPath, 2);
    expect(fs.readFileSync(syncPath)).toEqual(memory);
    expect(fs.readFileSync(asyncPath)).toEqual(memory);
  });

  it('rejects a version it cannot write', () => {
    expect(() => writeBa2(FIXED_INPUT, 3)).toThrow(/cannot write version 3/);
  });
});

const handBuilt = (version: number, headerSize: number): Buffer => {
  const name = 'a.txt';
  const data = Buffer.from('payload');
  const entryAt = headerSize;
  const dataAt = entryAt + 36;
  const nameTableAt = dataAt + data.length;
  const header = Buffer.alloc(headerSize);
  header.write('BTDX', 0, 'ascii');
  header.writeUInt32LE(version, 4);
  header.write('GNRL', 8, 'ascii');
  header.writeUInt32LE(1, 12);
  header.writeBigUInt64LE(BigInt(nameTableAt), 16);
  if (headerSize >= 32) header.writeBigUInt64LE(1n, 24);
  if (headerSize >= 36) header.writeUInt32LE(0, 32); // zlib
  const entry = Buffer.alloc(36);
  entry.write('txt', 4, 'ascii');
  entry.writeBigUInt64LE(BigInt(dataAt), 16);
  entry.writeUInt32LE(data.length, 28);
  const nameBuf = Buffer.alloc(2 + name.length);
  nameBuf.writeUInt16LE(name.length);
  nameBuf.write(name, 2, 'utf8');
  return Buffer.concat([header, entry, data, nameBuf]);
};

describe('Ba2Reader header sizes', () => {
  it.each([
    [1, 24],
    [7, 24],
    [8, 24],
    [2, 32],
    [3, 36],
  ])('reads a hand-built version %i archive', (version, headerSize) => {
    const reader = openBuffer(handBuilt(version, headerSize));
    expect(reader.version).toBe(version);
    expect(reader.extractByName('a.txt')?.toString()).toBe('payload');
    reader.close();
  });

  it('names the version in the error for an unknown one', () => {
    expect(() => openBuffer(handBuilt(4, 24))).toThrow(/unsupported version 4/);
  });

  it('keeps the error for a non-GNRL archive type', () => {
    const buf = handBuilt(1, 24);
    buf.write('DX10', 8, 'ascii');
    expect(() => openBuffer(buf)).toThrow(/unsupported archive type "DX10"/);
  });
});

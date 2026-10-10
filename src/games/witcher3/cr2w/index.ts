/**
 * REDengine 3 CR2W resources, just far enough to read objects' properties.
 *
 * ```
 * "CR2W"  u32 version (164 in Remastered)  u32 flags  u64 timestamp
 * u32 buildVersion  u32 fileSize  u32 bufferSize  u32 crc  u32 chunkCount
 * 10 × table header { u32 offset, u32 count, u32 crc }:
 *   0 string pool (count = bytes)   1 names { u32 stringOffset, u32 hash }
 *   2 imports (8 B)   3 properties (8 B)
 *   4 chunks { u16 class, u16 flags, u32 parent, u32 size, u32 offset, u32 template, u32 crc }
 * chunk data: u8 0, then properties until a zero name:
 *   u16 name  u16 type  u32 size (counting itself)  value
 * ```
 *
 * Only the value types the plugin needs are decoded (`CName`, `LocalizedString`,
 * numbers, `Bool`); everything else is kept as its raw bytes, which the
 * size field lets a reader step over whatever it does not understand.
 */

const MAGIC = 'CR2W';
const HEADER_SIZE = 40;
const TABLE_COUNT = 10;
const CHUNK_SIZE = 24;

export type Cr2wValue = string | number | boolean | Buffer;

export type Cr2wChunk = {
  index: number;
  className: string;
  /** 1-based index of the parent chunk, 0 for a root. */
  parent: number;
  properties: Map<string, { type: string; value: Cr2wValue }>;
};

export type Cr2wFile = { version: number; names: string[]; chunks: Cr2wChunk[] };

const readCString = (buf: Buffer, offset: number): string => {
  const end = buf.indexOf(0, offset);
  return buf.toString('utf8', offset, end < 0 ? buf.length : end);
};

const decodeValue = (type: string, raw: Buffer, names: string[]): Cr2wValue => {
  switch (type) {
    case 'CName':
      return raw.length >= 2 ? (names[raw.readUInt16LE(0)] ?? '') : '';
    case 'LocalizedString':
    case 'Uint32':
      return raw.length >= 4 ? raw.readUInt32LE(0) : 0;
    case 'Int32':
      return raw.length >= 4 ? raw.readInt32LE(0) : 0;
    case 'Float':
      return raw.length >= 4 ? raw.readFloatLE(0) : 0;
    case 'Bool':
      return raw.length >= 1 ? raw[0] !== 0 : false;
    default:
      return Buffer.from(raw);
  }
};

const readProperties = (
  data: Buffer,
  names: string[],
): Map<string, { type: string; value: Cr2wValue }> => {
  const properties = new Map<string, { type: string; value: Cr2wValue }>();
  let pos = data[0] === 0 ? 1 : 0;
  while (pos + 2 <= data.length) {
    const nameIndex = data.readUInt16LE(pos);
    if (nameIndex === 0 || pos + 8 > data.length) break;
    const typeIndex = data.readUInt16LE(pos + 2);
    const size = data.readUInt32LE(pos + 4);
    if (size < 4 || pos + 4 + size > data.length) break;
    const name = names[nameIndex] ?? `#${nameIndex}`;
    const type = names[typeIndex] ?? `#${typeIndex}`;
    properties.set(name, {
      type,
      value: decodeValue(type, data.subarray(pos + 8, pos + 4 + size), names),
    });
    pos += 4 + size;
  }
  return properties;
};

/**
 * Parse a CR2W resource's chunks. `wantClass`, when given, limits property
 * decoding to the chunks of those classes; the rest are listed bare.
 */
export const readCr2w = (buf: Buffer, wantClass?: (className: string) => boolean): Cr2wFile => {
  if (buf.length < HEADER_SIZE + TABLE_COUNT * 12 || buf.toString('latin1', 0, 4) !== MAGIC) {
    throw new Error('Not a CR2W resource');
  }
  const version = buf.readUInt32LE(4);
  const table = (i: number) => ({
    offset: buf.readUInt32LE(HEADER_SIZE + i * 12),
    count: buf.readUInt32LE(HEADER_SIZE + i * 12 + 4),
  });
  const strings = table(0);
  const pool = buf.subarray(strings.offset, strings.offset + strings.count);
  const namesTable = table(1);
  const names: string[] = [];
  for (let i = 0; i < namesTable.count; i++) {
    names.push(readCString(pool, buf.readUInt32LE(namesTable.offset + i * 8)));
  }
  const chunkTable = table(4);
  const chunks: Cr2wChunk[] = [];
  for (let i = 0; i < chunkTable.count; i++) {
    const at = chunkTable.offset + i * CHUNK_SIZE;
    const className = names[buf.readUInt16LE(at)] ?? '';
    const parent = buf.readUInt32LE(at + 4);
    const size = buf.readUInt32LE(at + 8);
    const offset = buf.readUInt32LE(at + 12);
    const properties =
      !wantClass || wantClass(className)
        ? readProperties(buf.subarray(offset, offset + size), names)
        : new Map();
    chunks.push({ index: i + 1, className, parent, properties });
  }
  return { version, names, chunks };
};

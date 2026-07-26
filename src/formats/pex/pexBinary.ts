/** Shared binary helpers for PEX readers (Skyrim BE and FO4 LE). */
export type PexEndian = 'be' | 'le';

export const readUInt16 = (buf: Buffer, offset: number, endian: PexEndian): number =>
  endian === 'le' ? buf.readUInt16LE(offset) : buf.readUInt16BE(offset);

export const readWString = (
  buf: Buffer,
  offset: number,
  endian: PexEndian,
): { value: string; nextOffset: number } => {
  const len = readUInt16(buf, offset, endian);
  offset += 2;
  const value = buf.toString('utf8', offset, offset + len);
  return { value, nextOffset: offset + len };
};

export class PexBinaryReader {
  private pos: number;

  constructor(
    private readonly buf: Buffer,
    private readonly endian: PexEndian,
    start = 0,
  ) {
    this.pos = start;
  }

  get offset(): number {
    return this.pos;
  }

  readU8(): number {
    const value = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return value;
  }

  readU16(): number {
    const value = readUInt16(this.buf, this.pos, this.endian);
    this.pos += 2;
    return value;
  }

  readU32(): number {
    const value =
      this.endian === 'le' ? this.buf.readUInt32LE(this.pos) : this.buf.readUInt32BE(this.pos);
    this.pos += 4;
    return value;
  }

  readI32(): number {
    const value =
      this.endian === 'le' ? this.buf.readInt32LE(this.pos) : this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return value;
  }

  readF32(): number {
    const value =
      this.endian === 'le' ? this.buf.readFloatLE(this.pos) : this.buf.readFloatBE(this.pos);
    this.pos += 4;
    return value;
  }

  readU64(): bigint {
    const value =
      this.endian === 'le'
        ? this.buf.readBigUInt64LE(this.pos)
        : this.buf.readBigUInt64BE(this.pos);
    this.pos += 8;
    return value;
  }
}

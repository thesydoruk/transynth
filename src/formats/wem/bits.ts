/**
 * Vorbis bit packing: fields of any width, least significant bit first, laid
 * into bytes from bit 0 up (Vorbis I spec, section 2). Wwise keeps the same
 * packing for the headers it rewrites, so one reader and one writer serve both
 * forms.
 */

const MAX_FIELD_BITS = 32;

export class BitReader {
  private bitPos = 0;

  constructor(private readonly bytes: Buffer) {}

  /** Bits consumed so far. */
  get position(): number {
    return this.bitPos;
  }

  /** Jump to a bit offset — to re-read a stretch, or to copy one by its bounds. */
  seek(bitPos: number): void {
    this.bitPos = bitPos;
  }

  get bitsLeft(): number {
    return this.bytes.length * 8 - this.bitPos;
  }

  /** Read an unsigned field of `bits` (0..32) bits. Reading past the end is an error. */
  read(bits: number): number {
    if (bits < 0 || bits > MAX_FIELD_BITS) throw new Error(`Bad bit field width ${bits}`);
    if (bits > this.bitsLeft) throw new Error('Vorbis data ends inside a field');
    let value = 0;
    let got = 0;
    while (got < bits) {
      const byte = this.bytes[this.bitPos >> 3]!;
      const offset = this.bitPos & 7;
      const take = Math.min(8 - offset, bits - got);
      const part = (byte >> offset) & ((1 << take) - 1);
      // Multiplication, not a shift: a 32-bit field must not turn negative.
      value += part * 2 ** got;
      got += take;
      this.bitPos += take;
    }
    return value;
  }
}

export class BitWriter {
  private readonly bytes: number[] = [];
  private bitPos = 0;

  /** Bits written so far. */
  get position(): number {
    return this.bitPos;
  }

  /** Write the low `bits` (0..32) bits of an unsigned value. */
  write(bits: number, value: number): void {
    if (bits < 0 || bits > MAX_FIELD_BITS) throw new Error(`Bad bit field width ${bits}`);
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** bits) {
      throw new Error(`Value ${value} does not fit a ${bits}-bit Vorbis field`);
    }
    let left = bits;
    let rest = value;
    while (left > 0) {
      const offset = this.bitPos & 7;
      if (offset === 0) this.bytes.push(0);
      const take = Math.min(8 - offset, left);
      const part = rest % 2 ** take;
      this.bytes[this.bytes.length - 1]! |= part << offset;
      rest = Math.floor(rest / 2 ** take);
      left -= take;
      this.bitPos += take;
    }
  }

  /** Copy `bits` bits from a reader, whatever the alignment of either side. */
  copy(from: BitReader, bits: number): void {
    let left = bits;
    while (left > 0) {
      const take = Math.min(left, 24);
      this.write(take, from.read(take));
      left -= take;
    }
  }

  /** The bytes written, the last one padded with zero bits. */
  toBuffer(): Buffer {
    return Buffer.from(this.bytes);
  }
}

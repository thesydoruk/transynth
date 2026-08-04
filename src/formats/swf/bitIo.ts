/**
 * Bit-level reader and writer for SWF structures.
 *
 * SWF packs many fields as unsigned (`UB`) or signed (`SB`) bit runs of a width the
 * stream itself declares, most significant bit first, and pads to a byte boundary at
 * the end of a structure.
 */

export class BitReader {
  private bit = 0;

  constructor(private readonly buf: Buffer) {}

  /** Read an unsigned bit field. */
  ub(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) {
      const byte = this.buf[this.bit >> 3] ?? 0;
      value = (value << 1) | ((byte >> (7 - (this.bit & 7))) & 1);
      this.bit++;
    }
    return value;
  }

  /** Read a signed bit field, sign-extending the top bit. */
  sb(count: number): number {
    if (count === 0) return 0;
    const raw = this.ub(count);
    const signBit = 1 << (count - 1);
    return raw & signBit ? raw - (signBit << 1) : raw;
  }

  get bytesRead(): number {
    return Math.ceil(this.bit / 8);
  }
}

export class BitWriter {
  private readonly bytes: number[] = [];
  private bit = 0;

  /** Write an unsigned bit field. */
  ub(count: number, value: number): void {
    for (let i = count - 1; i >= 0; i--) {
      const index = this.bit >> 3;
      if (this.bytes.length <= index) this.bytes.push(0);
      if ((value >> i) & 1) this.bytes[index]! |= 1 << (7 - (this.bit & 7));
      this.bit++;
    }
  }

  /** Write a signed bit field; the caller must size `count` to fit `value`. */
  sb(count: number, value: number): void {
    this.ub(count, value < 0 ? value + (1 << count) : value);
  }

  /** Pad the remaining bits of the current byte with zeros. */
  align(): void {
    if (this.bit & 7) this.bit = (this.bit | 7) + 1;
  }

  toBuffer(): Buffer {
    return Buffer.from(this.bytes);
  }
}

/**
 * Narrowest `SB` width that holds every value.
 *
 * `SB[n]` covers `-2^(n-1) .. 2^(n-1)-1`, so zero already fits in a single bit.
 */
export const signedBitWidth = (values: number[]): number => {
  let width = 1;
  for (const value of values) {
    while (value < -(2 ** (width - 1)) || value > 2 ** (width - 1) - 1) width++;
  }
  return width;
};

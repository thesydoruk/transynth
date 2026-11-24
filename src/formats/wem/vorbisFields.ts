/**
 * One walk for both directions of the Wwise ⇄ standard Vorbis rewrite.
 *
 * Wwise stores Vorbis headers with every redundant bit removed: constant
 * fields are dropped, wide ones narrowed. Going back is the same walk with the
 * roles of the two forms swapped, so the header walkers (`vorbisCodebook.ts`,
 * `vorbisSetup.ts`) are written once against this class and each field says
 * how the two forms differ. That is what keeps the writer the exact inverse of
 * the reader.
 */
import { BitReader, BitWriter } from './bits';

export type VorbisRewrite = 'toStandard' | 'toWwise';

/** Audiokinetic's 32-bit FNV-1 (`AK::FNVHash32`): multiply by the prime, then xor the byte. */
export const fnv1Hash32 = (bytes: Iterable<number>, seed = 0x811c9dc5): number => {
  let hash = seed;
  for (const byte of bytes) hash = (Math.imul(hash, 0x01000193) ^ byte) >>> 0;
  return hash;
};

export class FieldRewriter {
  private structure = fnv1Hash32([]);

  constructor(
    readonly input: BitReader,
    readonly output: BitWriter,
    readonly direction: VorbisRewrite,
  ) {}

  /**
   * A fingerprint of every structural field walked so far — everything but
   * the {@link FieldRewriter.tuning} values. Two setups with the same one have
   * the same tables of the same sizes.
   */
  get shape(): number {
    return this.structure;
  }

  /** Fold a value that is part of the structure into {@link FieldRewriter.shape}. */
  structural(value: number): void {
    const bytes = [value % 256, (value >>> 8) % 256, (value >>> 16) % 256, value >>> 24];
    this.structure = fnv1Hash32(bytes, this.structure);
  }

  /** A field both forms carry at the same width. */
  same(bits: number): number {
    const value = this.input.read(bits);
    this.output.write(bits, value);
    this.structural(value);
    return value;
  }

  /**
   * Like {@link FieldRewriter.same}, for a value that tunes the decoder
   * without changing what it has to allocate: a floor curve position, the
   * frequency range of a residue.
   */
  tuning(bits: number): number {
    const value = this.input.read(bits);
    this.output.write(bits, value);
    return value;
  }

  /** A field Wwise narrowed. A standard value that does not fit the Wwise width is refused. */
  narrowed(wwiseBits: number, standardBits: number, what: string): number {
    const toStandard = this.direction === 'toStandard';
    const value = this.input.read(toStandard ? wwiseBits : standardBits);
    if (!toStandard && value >= 2 ** wwiseBits) {
      throw new Error(`Vorbis ${what} ${value} does not fit Wwise's ${wwiseBits}-bit field`);
    }
    this.output.write(toStandard ? standardBits : wwiseBits, value);
    this.structural(value);
    return value;
  }

  /**
   * A field only the standard form has, holding the one value Wwise assumes:
   * written when rebuilding, checked and dropped when stripping.
   */
  standardOnly(bits: number, value: number, what: string): void {
    if (this.direction === 'toStandard') {
      this.output.write(bits, value);
      return;
    }
    const found = this.input.read(bits);
    if (found !== value) {
      throw new Error(`Vorbis ${what} is ${found}; Wwise Vorbis can only carry ${value}`);
    }
  }
}

/** Bits needed to write `value` (Vorbis `ilog`): 0 for 0, 3 for 7, 4 for 8. */
export const ilog = (value: number): number => {
  let bits = 0;
  for (let rest = value; rest > 0; rest = Math.floor(rest / 2)) bits++;
  return bits;
};

/**
 * Vorbis codebooks as Wwise stores them, and the library Wwise looks them up in.
 *
 * A Wwise Vorbis take does not carry its codebooks. The setup packet names each
 * one by a 10-bit id into a table compiled into the Wwise runtime — the
 * codebooks of the aoTuV beta 6.03 encoder since Wwise 2011.2 — and the table
 * keeps every codebook in a packed form (4-bit dimensions, 14-bit entry count,
 * codeword lengths at the narrowest width that holds them, 1-bit lookup type).
 *
 * The table here is `packed_codebooks_aoTuV_603.bin` from ww2ogg
 * (github.com/hcs64/ww2ogg, BSD-3-Clause; see `data/` and doc/THIRD_PARTY.md),
 * and the packed layout is ported from its `codebook.cpp`. Reading rebuilds the
 * standard codebook from an id; writing finds the id of a standard codebook, so
 * an encoder can only use codebooks that are in the table.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BitReader, BitWriter } from './bits';
import { FieldRewriter, ilog } from './vorbisFields';

const CODEBOOK_SYNC = 0x564342; // "BCV"
const LIBRARY_PATH = fileURLToPath(
  new URL('./data/packed_codebooks_aoTuV_603.bin', import.meta.url),
);

/** Values per dimension of a lookup-type-1 codebook (Vorbis `lookup1_values`). */
const lookup1Values = (entries: number, dimensions: number): number => {
  let values = Math.floor(Math.exp(Math.log(entries) / dimensions));
  while ((values + 1) ** dimensions <= entries) values++;
  while (values > 0 && values ** dimensions > entries) values--;
  return values;
};

/**
 * Width Wwise needs for the unordered codeword lengths ahead in a standard
 * codebook: the narrowest that holds the longest one. The reader is left where
 * it was.
 */
const codewordLengthBits = (input: BitReader, entries: number): number => {
  const start = input.position;
  const sparse = input.read(1);
  let longest = 0;
  for (let i = 0; i < entries; i++) {
    if (sparse && !input.read(1)) continue;
    longest = Math.max(longest, input.read(5));
  }
  input.seek(start);
  return Math.max(1, ilog(longest));
};

/** Rewrite one codebook between the packed Wwise form and the standard one. */
export const rewriteCodebook = (io: FieldRewriter): void => {
  io.standardOnly(24, CODEBOOK_SYNC, 'codebook sync pattern');
  const dimensions = io.narrowed(4, 16, 'codebook dimensions');
  const entries = io.narrowed(14, 24, 'codebook entry count');

  if (io.same(1)) {
    // Ordered: an initial length, then how many entries have each length.
    io.same(5);
    let current = 0;
    while (current < entries) current += io.same(ilog(entries - current));
    if (current > entries) throw new Error('Vorbis codebook lists more entries than it has');
  } else {
    // Wwise states the width of the lengths, 3 bits, ahead of the sparse flag.
    let lengthBits: number;
    if (io.direction === 'toStandard') {
      lengthBits = io.input.read(3);
      if (lengthBits === 0 || lengthBits > 5) {
        throw new Error(`Wwise codebook has ${lengthBits}-bit codeword lengths`);
      }
    } else {
      lengthBits = codewordLengthBits(io.input, entries);
      io.output.write(3, lengthBits);
    }
    const sparse = io.same(1);
    for (let i = 0; i < entries; i++) {
      if (sparse && !io.same(1)) continue;
      io.narrowed(lengthBits, 5, 'codeword length');
    }
  }

  // Lookup type 0 (none) or 1 (lattice); Wwise has one bit for it.
  if (io.narrowed(1, 4, 'codebook lookup type') === 1) {
    io.same(32); // minimum value
    io.same(32); // delta value
    const valueBits = io.same(4) + 1;
    io.same(1); // sequence flag
    for (let i = lookup1Values(entries, dimensions); i > 0; i--) io.same(valueBits);
  }
};

export type CodebookLibrary = {
  /** Codebooks in the table. */
  readonly size: number;
  /** Write the standard form of codebook `id`. */
  rebuild(id: number, output: BitWriter): void;
  /**
   * Ids of the codebook whose standard form is bits `start..end` of `input`,
   * ascending; empty when the table does not have it. The table repeats some
   * codebooks: neighbouring quality levels share most of theirs, and each
   * level has its own run of ids.
   */
  find(input: Buffer, start: number, end: number): readonly number[];
};

const bitsKey = (bytes: Buffer, start: number, end: number): string => {
  const reader = new BitReader(bytes);
  reader.seek(start);
  const writer = new BitWriter();
  writer.copy(reader, end - start);
  return `${end - start}:${writer.toBuffer().toString('latin1')}`;
};

/**
 * Parse a packed codebook table: the codebooks back to back, then a table of
 * u32 offsets — one per codebook plus the end — whose own offset is the file's
 * last u32.
 */
export const parseCodebookLibrary = (packed: Buffer): CodebookLibrary => {
  const tableOffset = packed.readUInt32LE(packed.length - 4);
  const size = (packed.length - tableOffset) / 4 - 1;
  if (!Number.isInteger(size) || size < 1) throw new Error('Bad Wwise codebook table');
  const bounds = (id: number): [number, number] => [
    packed.readUInt32LE(tableOffset + id * 4),
    packed.readUInt32LE(tableOffset + id * 4 + 4),
  ];

  const rebuild = (id: number, output: BitWriter): void => {
    if (!Number.isInteger(id) || id < 0 || id >= size) {
      throw new Error(`Wwise codebook id ${id} is not in the aoTuV 6.03 table (${size} codebooks)`);
    }
    const [start, end] = bounds(id);
    const input = new BitReader(packed.subarray(start, end));
    rewriteCodebook(new FieldRewriter(input, output, 'toStandard'));
    // A packed codebook ends in its last partial byte, or a zero byte if it had none.
    if (Math.floor(input.position / 8) + 1 !== end - start) {
      throw new Error(`Wwise codebook ${id} does not fill its ${end - start} bytes`);
    }
  };

  let ids: Map<string, number[]> | undefined;
  const index = (): Map<string, number[]> => {
    const map = new Map<string, number[]>();
    for (let id = 0; id < size; id++) {
      const standard = new BitWriter();
      rebuild(id, standard);
      const key = bitsKey(standard.toBuffer(), 0, standard.position);
      map.set(key, [...(map.get(key) ?? []), id]);
    }
    return map;
  };

  return {
    size,
    rebuild,
    find: (input, start, end) => (ids ??= index()).get(bitsKey(input, start, end)) ?? [],
  };
};

let library: CodebookLibrary | undefined;

/** The codebook table of Wwise 2011.2 and later, read once. */
export const wwiseCodebookLibrary = (): CodebookLibrary =>
  (library ??= parseCodebookLibrary(fs.readFileSync(LIBRARY_PATH)));

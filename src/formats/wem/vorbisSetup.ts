/**
 * The Vorbis setup header as Wwise stores it, and back.
 *
 * Wwise's setup packet is the standard one (Vorbis I spec, 4.2.4) with the
 * `0x05 "vorbis"` prefix, the time-domain placeholder, every type field that
 * has one legal value, and the framing bit removed, and with each codebook
 * replaced by its id in the runtime's table (`vorbisCodebook.ts`). The layout
 * is ported from ww2ogg's `wwriff.cpp` (BSD-3-Clause) and cross-read against
 * vgmstream's `vorbis_custom_utils_wwise.c`; this is the "external codebooks,
 * stripped setup" form every Wwise release since 2011 writes.
 */
import { BitReader, BitWriter } from './bits';
import { rewriteCodebook, type CodebookLibrary } from './vorbisCodebook';
import { FieldRewriter, ilog, type VorbisRewrite } from './vorbisFields';

const SETUP_PACKET_TYPE = 5;
const VORBIS_MAGIC = Buffer.from('vorbis', 'latin1');

/** What the audio packets need from the setup: one block-size flag per mode. */
export type VorbisModes = {
  /** `true` for a mode that uses the long block. */
  longBlock: boolean[];
  /** Width of a packet's mode number. */
  modeBits: number;
};

export type RewrittenSetup = {
  packet: Buffer;
  modes: VorbisModes;
  /**
   * Fingerprint of the setup's structure: codebooks, floor and residue layout,
   * mappings, modes — not the floor curve positions or residue ranges. Setups
   * that share it need the same decoder tables.
   */
  shape: number;
};

const packetPrefix = (io: FieldRewriter): void => {
  io.standardOnly(8, SETUP_PACKET_TYPE, 'setup packet type');
  for (const byte of VORBIS_MAGIC) io.standardOnly(8, byte, 'setup packet signature');
};

/**
 * Pick one id for each codebook that the table holds more than once: the one
 * nearest to an id this setup had no choice about. Wwise numbers the codebooks
 * of each quality level in one run and writes ids from that run, so this
 * reproduces the ids of its own encoder (measured on the game's setups).
 */
const resolveCodebookIds = (candidates: readonly (readonly number[])[]): number[] => {
  const fixed = candidates.filter((ids) => ids.length === 1).map((ids) => ids[0]!);
  const distance = (id: number): number => Math.min(...fixed.map((other) => Math.abs(other - id)));
  return candidates.map((ids) =>
    ids.reduce((best, id) => (fixed.length && distance(id) < distance(best) ? id : best)),
  );
};

const codebooks = (io: FieldRewriter, library: CodebookLibrary, source: Buffer): number => {
  const count = io.same(8) + 1;
  if (io.direction === 'toStandard') {
    for (let i = 0; i < count; i++) {
      const id = io.input.read(10);
      io.structural(id);
      library.rebuild(id, io.output);
    }
    return count;
  }
  const candidates: (readonly number[])[] = [];
  for (let i = 0; i < count; i++) {
    // Walk the standard codebook to learn where it ends, then look it up whole.
    const start = io.input.position;
    rewriteCodebook(new FieldRewriter(io.input, new BitWriter(), 'toWwise'));
    const ids = library.find(source, start, io.input.position);
    if (ids.length === 0) {
      throw new Error(
        `Vorbis codebook ${i} of ${count} is not in the Wwise codebook table; the Wwise decoder cannot be given it`,
      );
    }
    candidates.push(ids);
  }
  for (const id of resolveCodebookIds(candidates)) {
    io.structural(id);
    io.output.write(10, id);
  }
  return count;
};

const bookIndex = (io: FieldRewriter, codebookCount: number, what: string): void => {
  if (io.same(8) >= codebookCount) throw new Error(`Vorbis setup: invalid ${what}`);
};

const floors = (io: FieldRewriter, codebookCount: number): number => {
  const count = io.same(6) + 1;
  for (let i = 0; i < count; i++) {
    io.standardOnly(16, 1, 'floor type');
    const partitionClasses: number[] = [];
    for (let j = io.same(5); j > 0; j--) partitionClasses.push(io.same(4));
    const classDimensions: number[] = [];
    for (let j = 0; j <= Math.max(-1, ...partitionClasses); j++) {
      classDimensions.push(io.same(3) + 1);
      const subclassBits = io.same(2);
      if (subclassBits) bookIndex(io, codebookCount, 'floor master codebook');
      for (let k = 0; k < 1 << subclassBits; k++) {
        // Stored plus one; zero means "no codebook".
        if (io.same(8) > codebookCount) throw new Error('Vorbis setup: invalid floor codebook');
      }
    }
    io.same(2); // multiplier
    const rangeBits = io.same(4);
    for (const cls of partitionClasses) {
      for (let k = classDimensions[cls]!; k > 0; k--) io.tuning(rangeBits);
    }
  }
  return count;
};

const residues = (io: FieldRewriter, codebookCount: number): number => {
  const count = io.same(6) + 1;
  for (let i = 0; i < count; i++) {
    io.narrowed(2, 16, 'residue type');
    io.tuning(24); // begin
    io.tuning(24); // end
    io.same(24); // partition size
    const classifications = io.same(6) + 1;
    bookIndex(io, codebookCount, 'residue class codebook');
    const cascades: number[] = [];
    for (let j = 0; j < classifications; j++) {
      const low = io.same(3);
      cascades.push((io.same(1) ? io.same(5) : 0) * 8 + low);
    }
    for (const cascade of cascades) {
      for (let k = 0; k < 8; k++) {
        if (cascade & (1 << k)) bookIndex(io, codebookCount, 'residue codebook');
      }
    }
  }
  return count;
};

const mappings = (
  io: FieldRewriter,
  channels: number,
  floorCount: number,
  residueCount: number,
): number => {
  const count = io.same(6) + 1;
  for (let i = 0; i < count; i++) {
    io.standardOnly(16, 0, 'mapping type');
    const submaps = io.same(1) ? io.same(4) + 1 : 1;
    if (io.same(1)) {
      const channelBits = ilog(channels - 1);
      for (let j = io.same(8) + 1; j > 0; j--) {
        const magnitude = io.same(channelBits);
        const angle = io.same(channelBits);
        if (angle === magnitude || magnitude >= channels || angle >= channels) {
          throw new Error('Vorbis setup: invalid channel coupling');
        }
      }
    }
    if (io.same(2) !== 0) throw new Error('Vorbis setup: reserved mapping field is not zero');
    if (submaps > 1) {
      for (let j = 0; j < channels; j++) {
        if (io.same(4) >= submaps) throw new Error('Vorbis setup: invalid channel submap');
      }
    }
    for (let j = 0; j < submaps; j++) {
      io.same(8); // unused time-domain configuration, kept by Wwise
      if (io.same(8) >= floorCount) throw new Error('Vorbis setup: invalid submap floor');
      if (io.same(8) >= residueCount) throw new Error('Vorbis setup: invalid submap residue');
    }
  }
  return count;
};

const modes = (io: FieldRewriter, mappingCount: number): VorbisModes => {
  const count = io.same(6) + 1;
  const longBlock: boolean[] = [];
  for (let i = 0; i < count; i++) {
    longBlock.push(io.same(1) === 1);
    io.standardOnly(16, 0, 'mode window type');
    io.standardOnly(16, 0, 'mode transform type');
    if (io.same(8) >= mappingCount) throw new Error('Vorbis setup: invalid mode mapping');
  }
  return { longBlock, modeBits: ilog(count - 1) };
};

/**
 * Rewrite a whole setup packet. `toStandard` takes Wwise's and returns the
 * standard one a Vorbis decoder reads; `toWwise` is the inverse and throws for
 * a setup Wwise cannot express — above all a codebook its table does not have.
 */
export const rewriteVorbisSetup = (
  packet: Buffer,
  direction: VorbisRewrite,
  options: { channels: number; library: CodebookLibrary },
): RewrittenSetup => {
  const input = new BitReader(packet);
  const output = new BitWriter();
  const io = new FieldRewriter(input, output, direction);

  packetPrefix(io);
  const codebookCount = codebooks(io, options.library, packet);
  io.standardOnly(6, 0, 'time-domain transform count');
  io.standardOnly(16, 0, 'time-domain transform');
  const floorCount = floors(io, codebookCount);
  const residueCount = residues(io, codebookCount);
  const mappingCount = mappings(io, options.channels, floorCount, residueCount);
  const result = modes(io, mappingCount);
  io.standardOnly(1, 1, 'setup framing bit');

  // Either form ends in the byte its last field falls in.
  if (Math.ceil(input.position / 8) !== packet.length) {
    throw new Error(
      `Vorbis setup packet has ${packet.length} bytes but its fields end in byte ${Math.ceil(input.position / 8)}`,
    );
  }
  return { packet: output.toBuffer(), modes: result, shape: io.shape };
};

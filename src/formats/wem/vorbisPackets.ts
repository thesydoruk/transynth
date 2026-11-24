/**
 * Vorbis packets other than the setup: the audio packets Wwise shortens, and
 * the identification and comment headers it leaves out altogether.
 *
 * A standard audio packet opens with a type bit (0), the mode number and — for
 * a long block — the block sizes of its two neighbours. Wwise ("modified
 * packets", every take whose two block sizes differ) keeps only the mode
 * number: the type is known and the neighbours can be looked at. Everything
 * after those bits is the same stream, shifted by one or three bits.
 */
import { BitReader, BitWriter } from './bits';
import type { VorbisModes } from './vorbisSetup';

const VORBIS_MAGIC = Buffer.from('vorbis', 'latin1');
const VENDOR = 'transynth';

const modeOf = (packet: Buffer, modes: VorbisModes, standard: boolean): number => {
  if (packet.length === 0) throw new Error('Empty Vorbis audio packet');
  const mode = (packet[0]! >> (standard ? 1 : 0)) & ((1 << modes.modeBits) - 1);
  if (mode >= modes.longBlock.length) throw new Error(`Vorbis packet names mode ${mode}`);
  return mode;
};

/** Whether each packet is a long block. `standard` says which form the packets are in. */
export const packetBlockFlags = (
  packets: readonly Buffer[],
  modes: VorbisModes,
  standard: boolean,
): boolean[] => packets.map((packet) => modes.longBlock[modeOf(packet, modes, standard)]!);

/**
 * Samples each packet adds to the output: a quarter of its own block plus a
 * quarter of the one before, and nothing for the first, which only primes the
 * overlap. Their sum is what the packets decode to; a take plays the first
 * `samples` of that.
 */
export const packetSampleCounts = (
  longFlags: readonly boolean[],
  blockSizeBits: readonly [number, number],
): number[] => {
  const size = (long: boolean): number => 1 << blockSizeBits[long ? 1 : 0];
  return longFlags.map((long, i) => (i === 0 ? 0 : (size(longFlags[i - 1]!) + size(long)) / 4));
};

/** Wwise audio packets to standard ones: put the type bit and the window flags back. */
export const audioPacketsToStandard = (
  packets: readonly Buffer[],
  modes: VorbisModes,
): Buffer[] => {
  const long = packetBlockFlags(packets, modes, false);
  return packets.map((packet, i) => {
    const input = new BitReader(packet);
    const output = new BitWriter();
    output.write(1, 0);
    output.write(modes.modeBits, input.read(modes.modeBits));
    if (long[i]) {
      output.write(1, long[i - 1] ? 1 : 0);
      output.write(1, long[i + 1] ? 1 : 0);
    }
    output.copy(input, input.bitsLeft);
    return output.toBuffer();
  });
};

/**
 * Standard audio packets to Wwise ones. The window flags that are dropped must
 * be the ones a decoder will put back, or the take would decode with other
 * windows than it was encoded with; the two that cannot matter — before the
 * first packet and after the last, both outside the audio — are not checked.
 */
export const audioPacketsToWwise = (packets: readonly Buffer[], modes: VorbisModes): Buffer[] => {
  for (const [i, packet] of packets.entries()) {
    if (packet.length === 0 || packet[0]! & 1) {
      throw new Error(`Vorbis packet ${i} is not an audio packet`);
    }
  }
  const long = packetBlockFlags(packets, modes, true);
  return packets.map((packet, i) => {
    const input = new BitReader(packet);
    const output = new BitWriter();
    input.read(1);
    output.write(modes.modeBits, input.read(modes.modeBits));
    if (long[i]) {
      const previous = input.read(1) === 1;
      const next = input.read(1) === 1;
      const wrong =
        (i > 0 && previous !== long[i - 1]) || (i + 1 < packets.length && next !== long[i + 1]);
      if (wrong) throw new Error(`Vorbis packet ${i} has window flags its neighbours contradict`);
    }
    output.copy(input, input.bitsLeft);
    return output.toBuffer();
  });
};

export type VorbisIdentification = {
  channels: number;
  sampleRate: number;
  /** Nominal bitrate, bits per second; informational. */
  bitrate: number;
  /** log2 of the short and the long block size. */
  blockSizeBits: readonly [number, number];
};

/** The identification header Wwise leaves out: its fields live in the take's `fmt `. */
export const buildIdentificationHeader = (id: VorbisIdentification): Buffer => {
  const header = Buffer.alloc(30);
  header[0] = 1;
  VORBIS_MAGIC.copy(header, 1);
  header.writeUInt32LE(0, 7); // Vorbis version
  header[11] = id.channels;
  header.writeUInt32LE(id.sampleRate, 12);
  header.writeInt32LE(0, 16); // maximum bitrate: unset
  header.writeInt32LE(id.bitrate, 20);
  header.writeInt32LE(0, 24); // minimum bitrate: unset
  header[28] = id.blockSizeBits[0] | (id.blockSizeBits[1] << 4);
  header[29] = 1; // framing bit
  return header;
};

export const parseIdentificationHeader = (header: Buffer): VorbisIdentification => {
  if (header.length < 30 || header[0] !== 1 || !header.subarray(1, 7).equals(VORBIS_MAGIC)) {
    throw new Error('Not a Vorbis identification header');
  }
  return {
    channels: header[11]!,
    sampleRate: header.readUInt32LE(12),
    bitrate: header.readInt32LE(20),
    blockSizeBits: [header[28]! & 15, header[28]! >> 4],
  };
};

/** A comment header with a vendor string and no comments. */
export const buildCommentHeader = (): Buffer => {
  const vendor = Buffer.from(VENDOR, 'latin1');
  const header = Buffer.alloc(7 + 4 + vendor.length + 4 + 1);
  header[0] = 3;
  VORBIS_MAGIC.copy(header, 1);
  header.writeUInt32LE(vendor.length, 7);
  vendor.copy(header, 11);
  header[header.length - 1] = 1; // framing bit
  return header;
};

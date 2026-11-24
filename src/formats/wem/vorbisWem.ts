/**
 * Wwise Vorbis (`fmt ` tag 0xFFFF) as Wwise 2012 and later write it — the
 * voice takes of Starfield on PC.
 *
 * A take is a RIFF file with two chunks, no padding between them:
 *
 * ```
 * fmt   66 bytes  WAVEFORMATEX (tag 0xFFFF, block align 0, bits 0, 48 extra bytes):
 *                 +0x12 u16 0, +0x14 u32 channel configuration (0x4101 mono),
 *                 +0x18 u32 samples the take plays,
 *                 +0x1c u32 loop start, +0x20 u32 loop end — packet offsets counted
 *                           from the setup packet; first audio packet and end of
 *                           data when nothing loops,
 *                 +0x24 u16 0, +0x26 u16 extra samples at the loop end (= +0x32),
 *                 +0x28 u32 seek table size, +0x2c u32 offset of the first audio
 *                           packet in `data`,
 *                 +0x30 u16 largest audio packet, +0x32 u16 samples the last packet
 *                           decodes past the end,
 *                 +0x34 u32, +0x38 u32 decoder memory for the setup (32/64-bit),
 *                 +0x3c u32 FNV-1 of the setup packet: the key the runtime shares
 *                           decoded setups under,
 *                 +0x40 u8, +0x41 u8 log2 of the short and the long block size
 * data  seek table: u16 samples, u16 bytes per entry, each counted from the one
 *                 before — a packet to start decoding at about every 16,384 samples
 *       setup packet, then the audio packets, each behind a u16 size
 * ```
 *
 * Field names are Audiokinetic's (`AkVorbisInfo`), layout from vgmstream's
 * `meta/wwise.c` and ww2ogg, every value checked against 3,737 of the game's
 * takes: given the setup, packets and length of any of the 3,609 mono ones,
 * `buildVorbisWem` writes that take back byte for byte. Older Wwise forms (a
 * `vorb` chunk, 6- or 8-byte packet headers, inline codebooks) are refused by
 * name: the game ships none.
 */
import type { VorbisModes } from './vorbisSetup';
import { fnv1Hash32 } from './vorbisFields';
import { packetBlockFlags, packetSampleCounts } from './vorbisPackets';
import {
  describeWem,
  unsupportedWemCodecMessage,
  WEM_VORBIS_FORMAT_TAG,
  wemCodecLabel,
  type WemChunk,
} from './riff';

const FMT_SIZE = 0x42;
/** Samples between seek table entries, at least: Wwise's default granularity. */
const SEEK_GRANULARITY = 16384;
const MONO_CHANNEL_CONFIG = 0x4101;

export type VorbisWem = {
  channels: number;
  sampleRate: number;
  /** Samples the take plays; the packets decode to a little more. */
  samples: number;
  /** `fmt ` average byte rate; the nominal bitrate of the rebuilt stream. */
  bytesPerSecond: number;
  /** log2 of the short and the long block size. */
  blockSizeBits: readonly [number, number];
  /** The setup packet, in Wwise's form. */
  setup: Buffer;
  /** The audio packets, in Wwise's form. */
  packets: Buffer[];
};

const chunkBody = (riff: Buffer, chunk: WemChunk): Buffer => {
  if (chunk.offset + chunk.size > riff.length) {
    throw new Error(`Wwise Vorbis take is cut short inside its ${chunk.id.trim()} chunk`);
  }
  return riff.subarray(chunk.offset, chunk.offset + chunk.size);
};

const readPackets = (data: Buffer, start: number): Buffer[] => {
  const packets: Buffer[] = [];
  let pos = start;
  while (pos < data.length) {
    if (pos + 2 > data.length) throw new Error('Wwise Vorbis take ends inside a packet header');
    const size = data.readUInt16LE(pos);
    if (size === 0 || pos + 2 + size > data.length) {
      throw new Error(`Wwise Vorbis take has a bad ${size}-byte packet at data offset ${pos}`);
    }
    packets.push(data.subarray(pos + 2, pos + 2 + size));
    pos += 2 + size;
  }
  return packets;
};

/**
 * Read a Wwise Vorbis take. Another codec is refused by name; another Wwise
 * Vorbis layout than the one described above is refused saying which.
 */
export const parseVorbisWem = (riff: Buffer): VorbisWem => {
  const description = describeWem(riff);
  if (description.formatTag !== WEM_VORBIS_FORMAT_TAG) {
    throw new Error(unsupportedWemCodecMessage(description, 'vorbis'));
  }
  const otherLayout = (what: string): Error =>
    new Error(
      `Unsupported WEM codec: the take is ${wemCodecLabel(description)} in a layout that is not read: ${what}. Only the layout of Wwise 2012 and later is (a ${FMT_SIZE}-byte fmt chunk, no vorb chunk, two block sizes).`,
    );
  const chunk = (id: string): WemChunk | undefined => description.chunks.find((c) => c.id === id);
  if (chunk('vorb')) throw otherLayout('it has a vorb chunk');
  const fmtChunk = chunk('fmt ')!;
  const dataChunk = chunk('data');
  if (fmtChunk.size !== FMT_SIZE) throw otherLayout(`its fmt chunk has ${fmtChunk.size} bytes`);
  if (!dataChunk) throw new Error('Wwise Vorbis take has no data chunk');
  const fmt = chunkBody(riff, fmtChunk);
  const data = chunkBody(riff, dataChunk);

  const blockSizeBits = [fmt[0x40]!, fmt[0x41]!] as const;
  if (blockSizeBits[0] >= blockSizeBits[1]) {
    // With one block size Wwise keeps standard packets; the game has no such take.
    throw otherLayout(`its block sizes are 2^${blockSizeBits[0]} and 2^${blockSizeBits[1]}`);
  }
  const seekSize = fmt.readUInt32LE(0x28);
  const audioOffset = fmt.readUInt32LE(0x2c);
  if (seekSize + 2 > data.length) throw new Error('Wwise Vorbis take has no setup packet');
  const setupSize = data.readUInt16LE(seekSize);
  if (audioOffset !== seekSize + 2 + setupSize || audioOffset > data.length) {
    throw new Error('Wwise Vorbis take: the first audio packet does not follow the setup packet');
  }
  return {
    channels: description.channels,
    sampleRate: description.sampleRate,
    samples: fmt.readUInt32LE(0x18),
    bytesPerSecond: fmt.readUInt32LE(8),
    blockSizeBits,
    setup: data.subarray(seekSize + 2, audioOffset),
    packets: readPackets(data, audioOffset),
  };
};

/** Seconds the take plays. */
export const vorbisWemDuration = (wem: Pick<VorbisWem, 'samples' | 'sampleRate'>): number =>
  wem.samples / wem.sampleRate;

const sized = (packet: Buffer): Buffer => {
  if (packet.length > 0xffff) throw new Error('Vorbis packet too large for a Wwise take');
  const head = Buffer.alloc(2);
  head.writeUInt16LE(packet.length, 0);
  return Buffer.concat([head, packet]);
};

/**
 * The seek table: one entry for each packet by which the output has advanced
 * a granularity since the entry before. An entry says where decoding can start
 * — the packet's offset — and the first sample that start produces.
 */
const buildSeekTable = (packets: readonly Buffer[], sampleCounts: readonly number[]): Buffer => {
  const entries: number[] = [];
  let offset = 0;
  let decoded = 0;
  let entryOffset = 0;
  let entryDecoded = 0;
  packets.forEach((packet, i) => {
    decoded += sampleCounts[i]!;
    if (decoded - entryDecoded >= SEEK_GRANULARITY) {
      entries.push(decoded - entryDecoded, offset - entryOffset);
      entryDecoded = decoded;
      entryOffset = offset;
    }
    offset += packet.length;
  });
  const table = Buffer.alloc(entries.length * 2);
  entries.forEach((value, i) => {
    if (value > 0xffff) throw new Error('Wwise Vorbis seek table entry out of range');
    table.writeUInt16LE(value, i * 2);
  });
  return table;
};

export type BuildVorbisWemInput = {
  sampleRate: number;
  /** Samples the take plays. */
  samples: number;
  blockSizeBits: readonly [number, number];
  /** Setup packet in Wwise's form, and the modes it defines. */
  setup: Buffer;
  modes: VorbisModes;
  /** Audio packets in Wwise's form. */
  packets: readonly Buffer[];
  /** Memory the 32- and the 64-bit runtime need to decode this setup. */
  decoderMemory: readonly [number, number];
};

/** Write a mono take the way the game's own are written. */
export const buildVorbisWem = (input: BuildVorbisWemInput): Buffer => {
  const packets = [...input.packets];
  const sampleCounts = packetSampleCounts(
    packetBlockFlags(packets, input.modes, false),
    input.blockSizeBits,
  );
  let decodable = sampleCounts.reduce((sum, count) => sum + count, 0);
  if (input.samples <= 0 || input.samples > decodable) {
    throw new Error(
      `Vorbis packets decode to ${decodable} samples, not the ${input.samples} stated`,
    );
  }
  // No take of the game ends in a packet that starts past its length: such a
  // packet adds nothing, and the end is always inside the last one.
  while (packets.length > 1 && decodable - sampleCounts.at(-1)! >= input.samples) {
    decodable -= sampleCounts.pop()!;
    packets.pop();
  }
  const setup = sized(input.setup);
  const audio = packets.map(sized);
  const seek = buildSeekTable([setup, ...audio], [0, ...sampleCounts]);
  const data = Buffer.concat([seek, setup, ...audio]);
  const extra = decodable - input.samples;
  const seconds = input.samples / input.sampleRate;

  const fmt = Buffer.alloc(FMT_SIZE);
  fmt.writeUInt16LE(WEM_VORBIS_FORMAT_TAG, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(input.sampleRate, 4);
  fmt.writeUInt32LE(Math.floor((data.length - seek.length) / seconds), 8);
  fmt.writeUInt16LE(FMT_SIZE - 0x12, 0x10);
  fmt.writeUInt32LE(MONO_CHANNEL_CONFIG, 0x14);
  fmt.writeUInt32LE(input.samples, 0x18);
  fmt.writeUInt32LE(setup.length, 0x1c);
  fmt.writeUInt32LE(data.length - seek.length, 0x20);
  fmt.writeUInt16LE(extra, 0x26);
  fmt.writeUInt32LE(seek.length, 0x28);
  fmt.writeUInt32LE(seek.length + setup.length, 0x2c);
  fmt.writeUInt16LE(Math.max(...packets.map((packet) => packet.length)), 0x30);
  fmt.writeUInt16LE(extra, 0x32);
  fmt.writeUInt32LE(input.decoderMemory[0], 0x34);
  fmt.writeUInt32LE(input.decoderMemory[1], 0x38);
  fmt.writeUInt32LE(fnv1Hash32(input.setup), 0x3c);
  fmt[0x40] = input.blockSizeBits[0];
  fmt[0x41] = input.blockSizeBits[1];

  const head = (id: string, size: number): Buffer => {
    const header = Buffer.alloc(8);
    header.write(id, 0, 'latin1');
    header.writeUInt32LE(size, 4);
    return header;
  };
  const body = Buffer.concat([head('fmt ', fmt.length), fmt, head('data', data.length), data]);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'latin1');
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write('WAVE', 8, 'latin1');
  return Buffer.concat([riff, body]);
};

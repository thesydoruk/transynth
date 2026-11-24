/**
 * Wwise "WEM Opus" (codec 0x3041): the voice takes of The Witcher 3 (2022+)
 * and, with the same decoder in the engine, of Starfield.
 *
 * A take is a RIFF file with four chunks:
 *
 * ```
 * fmt   36 bytes  WAVEFORMATEX (tag 0x3041, 48 kHz) + 18 extra:
 *                 +0x12 u16 frame size (960 = 20 ms), +0x14 u32 channel layout,
 *                 +0x18 u32 samples, +0x1c u32 packet count, +0x20 u16 pre-skip,
 *                 +0x22 u8 version (1), +0x23 u8 mapping family
 * hash  16 bytes  Wwise's own media hash; not a checksum of the data
 * seek  u16 per packet: its size in bytes
 * data  the Opus packets back to back
 * ```
 *
 * No padding between chunks, even after an odd-sized `data`. That is plain
 * Opus underneath, so libopus (through ffmpeg, see `transcode.ts`) both decodes
 * and produces it without Wwise: measured on the Remastered `enpc.w3speech`,
 * the game's own packets are CELT-only 20 ms frames (TOC 0xf8), which
 * `-application lowdelay` also yields.
 */
import { muxOggOpus } from './ogg';
import {
  describeWem,
  readRiffChunks,
  unsupportedWemCodecMessage,
  WEM_OPUS_FORMAT_TAG,
} from './riff';

/** Opus always runs at 48 kHz; the take's `fmt ` says so too. */
export const OPUS_WEM_SAMPLE_RATE = 48000;
const SAMPLE_RATE = OPUS_WEM_SAMPLE_RATE;
const FRAME_SIZE = 960;
/** The channel-layout word mono takes in the game carry. */
const MONO_CHANNEL_LAYOUT = 0x4101;

export type OpusWem = {
  channels: number;
  sampleRate: number;
  /** Samples after the pre-skip — what the take plays. */
  samples: number;
  preSkip: number;
  frameSize: number;
  packets: Buffer[];
  /** The raw `fmt ` chunk, kept so a rewrite can mirror the fields not modelled here. */
  fmt: Buffer;
  hash: Buffer;
  /** Whether the file carried a `hash` chunk at all (`hash` is zeros when not). */
  hasHashChunk: boolean;
};

/**
 * Read a WEM Opus take. Any other Wwise codec is refused by name
 * ({@link unsupportedWemCodecMessage}) rather than misread.
 */
export const parseOpusWem = (riff: Buffer): OpusWem => {
  const chunks = readRiffChunks(riff);
  const fmt = chunks.get('fmt ');
  if (fmt && fmt.length >= 2 && fmt.readUInt16LE(0) !== WEM_OPUS_FORMAT_TAG) {
    throw new Error(unsupportedWemCodecMessage(describeWem(riff), 'opus'));
  }
  const seek = chunks.get('seek');
  const data = chunks.get('data');
  if (!fmt || !seek || !data) throw new Error('Opus take is missing fmt/seek/data');
  if (fmt.length < 36) throw new Error(`Opus take has a short fmt chunk (${fmt.length} bytes)`);
  const packets: Buffer[] = [];
  let offset = 0;
  for (let i = 0; i + 2 <= seek.length; i += 2) {
    const size = seek.readUInt16LE(i);
    packets.push(data.subarray(offset, offset + size));
    offset += size;
  }
  if (offset !== data.length) throw new Error('Opus take seek table does not cover its data');
  return {
    channels: fmt.readUInt16LE(2),
    sampleRate: fmt.readUInt32LE(4),
    samples: fmt.readUInt32LE(0x18),
    preSkip: fmt.readUInt16LE(0x20),
    frameSize: fmt.readUInt16LE(0x12) || FRAME_SIZE,
    packets,
    fmt: Buffer.from(fmt),
    hash: Buffer.from(chunks.get('hash') ?? Buffer.alloc(16)),
    hasHashChunk: chunks.has('hash'),
  };
};

/** Seconds the take plays — what the speech table stores after it. */
export const opusWemDuration = (wem: Pick<OpusWem, 'samples' | 'sampleRate'>): number =>
  wem.samples / wem.sampleRate;

const chunk = (id: string, body: Buffer): Buffer => {
  const head = Buffer.alloc(8);
  head.write(id, 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
};

export type BuildOpusWemInput = {
  packets: readonly Buffer[];
  channels: number;
  samples: number;
  preSkip: number;
  /**
   * The take being replaced. Its `fmt ` fields that are not modelled here
   * (channel layout, version, mapping) are copied, so a new take differs from
   * the game's own only in what it has to.
   */
  template?: Pick<OpusWem, 'fmt'>;
  /**
   * Defaults to 16 zero bytes, as the open-source encoders write it. `null`
   * leaves the chunk out, for a title whose own takes have none.
   */
  hash?: Buffer | null;
};

export const buildOpusWem = (input: BuildOpusWemInput): Buffer => {
  const data = Buffer.concat(input.packets);
  const seek = Buffer.alloc(input.packets.length * 2);
  input.packets.forEach((packet, i) => {
    if (packet.length > 0xffff) throw new Error(`Opus packet ${i} too large for a seek entry`);
    seek.writeUInt16LE(packet.length, i * 2);
  });

  const fmt = Buffer.alloc(36);
  if (input.template) input.template.fmt.copy(fmt, 0, 0, 36);
  else {
    fmt.writeUInt32LE(MONO_CHANNEL_LAYOUT, 0x14);
    fmt.writeUInt8(1, 0x22);
  }
  const seconds = input.samples / SAMPLE_RATE;
  fmt.writeUInt16LE(WEM_OPUS_FORMAT_TAG, 0);
  fmt.writeUInt16LE(input.channels, 2);
  fmt.writeUInt32LE(SAMPLE_RATE, 4);
  fmt.writeUInt32LE(seconds > 0 ? Math.floor(data.length / seconds) : 0, 8);
  fmt.writeUInt16LE(0, 0x0c);
  fmt.writeUInt16LE(0, 0x0e);
  fmt.writeUInt16LE(0x12, 0x10);
  fmt.writeUInt16LE(FRAME_SIZE, 0x12);
  fmt.writeUInt32LE(input.samples, 0x18);
  fmt.writeUInt32LE(input.packets.length, 0x1c);
  fmt.writeUInt16LE(input.preSkip, 0x20);

  const body = Buffer.concat([
    chunk('fmt ', fmt),
    ...(input.hash === null ? [] : [chunk('hash', input.hash ?? Buffer.alloc(16))]),
    chunk('seek', seek),
    chunk('data', data),
  ]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WAVE', 8, 'latin1');
  return Buffer.concat([header, body]);
};

/** The take as an Ogg Opus file ffmpeg can decode. */
export const opusWemToOgg = (wem: OpusWem): Buffer =>
  muxOggOpus(wem.packets, {
    channels: wem.channels,
    preSkip: wem.preSkip,
    frameSize: wem.frameSize,
  });

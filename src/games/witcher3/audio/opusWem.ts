/**
 * Witcher 3 voice takes: Wwise "Opus WEM" (codec 0x3041), as the 2022+ game ships them.
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
 * Opus underneath, so libopus (through ffmpeg) both decodes and produces it
 * without Wwise: measured on the Remastered `enpc.w3speech`, the game's own
 * packets are CELT-only 20 ms frames (TOC 0xf8), which `-application lowdelay`
 * also yields.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileAsync } from '../../../utils/execFile';
import { resolveFfmpegPath } from '../../../voice/voiceToolPaths';
import { demuxOggOpus, muxOggOpus } from './ogg';

const WEM_OPUS_FORMAT_TAG = 0x3041;
const SAMPLE_RATE = 48000;
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
};

const readChunks = (riff: Buffer): Map<string, Buffer> => {
  if (riff.toString('latin1', 0, 4) !== 'RIFF' || riff.toString('latin1', 8, 12) !== 'WAVE') {
    throw new Error('Not a RIFF/WAVE take');
  }
  const chunks = new Map<string, Buffer>();
  let pos = 12;
  while (pos + 8 <= riff.length) {
    const id = riff.toString('latin1', pos, pos + 4);
    const size = riff.readUInt32LE(pos + 4);
    chunks.set(id, riff.subarray(pos + 8, pos + 8 + size));
    pos += 8 + size;
  }
  return chunks;
};

export const parseOpusWem = (riff: Buffer): OpusWem => {
  const chunks = readChunks(riff);
  const fmt = chunks.get('fmt ');
  const seek = chunks.get('seek');
  const data = chunks.get('data');
  if (!fmt || !seek || !data) throw new Error('Opus take is missing fmt/seek/data');
  const tag = fmt.readUInt16LE(0);
  if (tag !== WEM_OPUS_FORMAT_TAG) {
    throw new Error(`Unsupported take codec 0x${tag.toString(16)} (expected Opus 0x3041)`);
  }
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
  /** Defaults to 16 zero bytes, as the open-source encoders write it. */
  hash?: Buffer;
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
    chunk('hash', input.hash ?? Buffer.alloc(16)),
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

const withTempDir = async <T>(fn: (dir: string) => Promise<T>): Promise<T> => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transynth-wem-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/** Decode a take to a WAV file (mono 16-bit unless `sampleRate`/`channels` say otherwise). */
export const decodeOpusWemToWav = async (
  riff: Buffer,
  outputPath: string,
  options: { sampleRate?: number; channels?: number } = {},
): Promise<void> =>
  withTempDir(async (dir) => {
    const ogg = path.join(dir, 'take.ogg');
    fs.writeFileSync(ogg, opusWemToOgg(parseOpusWem(riff)));
    await execFileAsync(resolveFfmpegPath(), [
      '-y',
      '-v',
      'error',
      '-i',
      ogg,
      '-ac',
      String(options.channels ?? 1),
      '-ar',
      String(options.sampleRate ?? SAMPLE_RATE),
      '-sample_fmt',
      's16',
      outputPath,
    ]);
  });

/** Decode any audio ffmpeg reads to mono float samples in [-1, 1]. */
const decodeAudioToPcm = async (inputPath: string, sampleRate: number): Promise<Float32Array> =>
  withTempDir(async (dir) => {
    const raw = path.join(dir, 'pcm.raw');
    await execFileAsync(resolveFfmpegPath(), [
      '-y',
      '-v',
      'error',
      '-i',
      inputPath,
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      's16le',
      raw,
    ]);
    return readPcm16(raw);
  });

/** Decode a take to mono float samples. */
export const decodeOpusWemToPcm = async (riff: Buffer, sampleRate: number): Promise<Float32Array> =>
  withTempDir(async (dir) => {
    const ogg = path.join(dir, 'take.ogg');
    fs.writeFileSync(ogg, opusWemToOgg(parseOpusWem(riff)));
    return decodeAudioToPcm(ogg, sampleRate);
  });

export type EncodeOpusWemOptions = {
  /** Target bitrate in kbit/s. The game's takes average about 66. */
  bitrateKbps?: number;
  template?: Pick<OpusWem, 'fmt'>;
  /** ffmpeg audio filters applied before encoding, e.g. `atempo=0.85`. */
  filter?: string;
};

const opusOutputArgs = (options: EncodeOpusWemOptions, ogg: string): string[] => [
  ...(options.filter ? ['-af', options.filter] : []),
  '-ac',
  '1',
  '-ar',
  String(SAMPLE_RATE),
  '-c:a',
  'libopus',
  '-b:a',
  `${options.bitrateKbps ?? 64}k`,
  '-frame_duration',
  '20',
  '-application',
  'lowdelay',
  ogg,
];

const takeFromOgg = (ogg: string, options: EncodeOpusWemOptions): Buffer => {
  const stream = demuxOggOpus(fs.readFileSync(ogg));
  return buildOpusWem({
    packets: stream.packets,
    channels: stream.channels,
    samples: Number(stream.finalGranule) - stream.preSkip,
    preSkip: stream.preSkip,
    ...(options.template ? { template: options.template } : {}),
  });
};

const readPcm16 = (raw: string): Float32Array => {
  const bytes = fs.readFileSync(raw);
  const pcm = new Float32Array(bytes.length >> 1);
  for (let i = 0; i < pcm.length; i++) pcm[i] = bytes.readInt16LE(i * 2) / 32768;
  return pcm;
};

/** Encode any audio ffmpeg reads into a mono Witcher 3 take. */
export const encodeAudioToOpusWem = async (
  inputPath: string,
  options: EncodeOpusWemOptions = {},
): Promise<Buffer> =>
  withTempDir(async (dir) => {
    const ogg = path.join(dir, 'take.ogg');
    await execFileAsync(resolveFfmpegPath(), [
      '-y',
      '-v',
      'error',
      '-i',
      inputPath,
      ...opusOutputArgs(options, ogg),
    ]);
    return takeFromOgg(ogg, options);
  });

/**
 * {@link encodeAudioToOpusWem} and {@link decodeAudioToPcm} in one ffmpeg run:
 * the take, and the same audio as mono samples at `pcmSampleRate` for the mouth
 * model. One process instead of two — on Windows a spawn alone costs ~100 ms a
 * line — and the samples come out of the same resampler as the training data.
 */
export const encodeAudioToOpusWemWithPcm = async (
  inputPath: string,
  pcmSampleRate: number,
  options: EncodeOpusWemOptions = {},
): Promise<{ take: Buffer; pcm: Float32Array }> =>
  withTempDir(async (dir) => {
    const ogg = path.join(dir, 'take.ogg');
    const raw = path.join(dir, 'pcm.raw');
    await execFileAsync(resolveFfmpegPath(), [
      '-y',
      '-v',
      'error',
      '-i',
      inputPath,
      ...opusOutputArgs(options, ogg),
      ...(options.filter ? ['-af', options.filter] : []),
      '-ac',
      '1',
      '-ar',
      String(pcmSampleRate),
      '-f',
      's16le',
      raw,
    ]);
    return { take: takeFromOgg(ogg, options), pcm: readPcm16(raw) };
  });

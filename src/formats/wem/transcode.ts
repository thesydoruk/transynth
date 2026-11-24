/**
 * WEM Opus in and out of ffmpeg: decode a take to WAV or samples, encode any
 * audio into a take. libopus does the work; Wwise is not involved.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileAsync } from '../../utils/execFile';
import { resolveFfmpegPath } from '../../voice/voiceToolPaths';
import { demuxOggOpus } from './ogg';
import {
  buildOpusWem,
  OPUS_WEM_SAMPLE_RATE as SAMPLE_RATE,
  opusWemToOgg,
  parseOpusWem,
  type OpusWem,
} from './opusWem';

export const withTempDir = async <T>(fn: (dir: string) => Promise<T>): Promise<T> => {
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
  /** Passed to {@link buildOpusWem}: `null` writes no `hash` chunk. */
  hash?: Buffer | null;
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
    ...(options.hash !== undefined ? { hash: options.hash } : {}),
  });
};

const readPcm16 = (raw: string): Float32Array => {
  const bytes = fs.readFileSync(raw);
  const pcm = new Float32Array(bytes.length >> 1);
  for (let i = 0; i < pcm.length; i++) pcm[i] = bytes.readInt16LE(i * 2) / 32768;
  return pcm;
};

/** Encode any audio ffmpeg reads into a mono WEM Opus take. */
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

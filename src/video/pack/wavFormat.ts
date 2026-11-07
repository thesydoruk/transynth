/**
 * The WAV header check before a dub goes to the mixer: Bink stores the sample
 * rate in 16 bits, so a 192 kHz WAV (what ffmpeg's loudnorm leaves behind)
 * mixes without a word of complaint and plays as silence in the game.
 */
import fs from 'node:fs';
import path from 'node:path';

const BINK_MAX_SAMPLE_RATE = 0xffff;
const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

export type WavFormat = { formatTag: number; channels: number; sampleRate: number; bits: number };

/** The `fmt ` chunk of a WAV file, or null when the file is not RIFF/WAVE. */
export const readWavFormat = (wavPath: string): WavFormat | null => {
  const buf = Buffer.alloc(4096);
  const fd = fs.openSync(wavPath, 'r');
  let read: number;
  try {
    read = fs.readSync(fd, buf, 0, buf.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (
    read < 12 ||
    buf.toString('ascii', 0, 4) !== 'RIFF' ||
    buf.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    return null;
  }
  let offset = 12;
  while (offset + 8 <= read) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === 'fmt ' && start + 16 <= read) {
      return {
        formatTag: buf.readUInt16LE(start),
        channels: buf.readUInt16LE(start + 2),
        sampleRate: buf.readUInt32LE(start + 4),
        bits: buf.readUInt16LE(start + 14),
      };
    }
    offset = start + size + (size % 2);
  }
  return null;
};

/** Refuse a WAV the mixer would accept but the game would not play. */
export const assertBinkSound = (wavPath: string): void => {
  const fmt = readWavFormat(wavPath);
  const name = path.basename(wavPath);
  if (!fmt) throw new Error(`${name} is not a RIFF/WAVE file`);
  if (fmt.sampleRate > BINK_MAX_SAMPLE_RATE) {
    throw new Error(
      `${name} is a ${fmt.sampleRate} Hz WAV; Bink stores the rate in 16 bits, so the dub must be 48 kHz`,
    );
  }
  if (
    fmt.bits !== 16 ||
    (fmt.formatTag !== WAVE_FORMAT_PCM && fmt.formatTag !== WAVE_FORMAT_EXTENSIBLE)
  ) {
    throw new Error(`${name} is not 16-bit PCM (format ${fmt.formatTag}, ${fmt.bits} bits)`);
  }
};

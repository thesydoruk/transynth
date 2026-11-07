/**
 * Put a sound track into a Bink video with RAD's mixer.
 *
 * `radvideo64.exe BinkMix <in> <sound> <out> /TrackID# …` rewrites one track
 * and leaves the picture alone, so a video with several language tracks is
 * mixed once per track, each pass reading the previous pass's output. The
 * mixer is a windowed tool: `/AutoClose` ends it on success, but an error
 * leaves a dialog waiting for a click, so every pass runs under a timeout and
 * counts only when it exits 0 and the output exists.
 *
 * The sound must be 16-bit PCM at a rate that fits Bink's 16-bit rate field:
 * a 192 kHz WAV (what ffmpeg's loudnorm leaves behind) mixes without a word
 * of complaint and plays as silence in the game.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileAsync } from '../../utils/execFile';

/** Bink Audio quality 4: "best" in RAD's own scale (0 = biggest, 6 = very lossy). */
const SOUND_COMPRESS_LEVEL = 4;
const PASS_TIMEOUT_MS = 15 * 60_000;

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
  if (!fmt) return; // Not a WAV header: the mixer reports that itself.
  const name = path.basename(wavPath);
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

export const binkMixArgs = (
  inputBk2: string,
  soundWav: string,
  outputBk2: string,
  trackId: number,
): string[] => [
  'BinkMix',
  inputBk2,
  soundWav,
  outputBk2,
  `/TrackID${trackId}`,
  `/SoundCompress${SOUND_COMPRESS_LEVEL}`,
  '/Overwrite',
  '/AutoClose',
];

export type BinkMixRunner = (
  exe: string,
  args: string[],
  opts: { timeoutMs: number },
) => Promise<unknown>;

export type ReplaceBinkTracksOptions = {
  radVideoExe: string;
  inputBk2: string;
  soundWav: string;
  outputBk2: string;
  /** Every id gets the same sound, so the game hears it whatever language it runs in. */
  trackIds: readonly number[];
  workDir: string;
  run?: BinkMixRunner;
  timeoutMs?: number;
};

/** Write `outputBk2` = `inputBk2` with `soundWav` on every listed track. */
export const replaceBinkTracks = async (opts: ReplaceBinkTracksOptions): Promise<void> => {
  if (opts.trackIds.length === 0) throw new Error('replaceBinkTracks: no track ids');
  assertBinkSound(opts.soundWav);
  const run = opts.run ?? execFileAsync;
  const timeoutMs = opts.timeoutMs ?? PASS_TIMEOUT_MS;
  fs.mkdirSync(opts.workDir, { recursive: true });
  fs.mkdirSync(path.dirname(opts.outputBk2), { recursive: true });
  let current = opts.inputBk2;
  for (const [i, trackId] of opts.trackIds.entries()) {
    const last = i === opts.trackIds.length - 1;
    const out = last ? opts.outputBk2 : path.join(opts.workDir, `mix-${i}.bk2`);
    fs.rmSync(out, { force: true });
    await run(opts.radVideoExe, binkMixArgs(current, opts.soundWav, out, trackId), { timeoutMs });
    if (!fs.existsSync(out)) {
      throw new Error(
        `binkmix left no output for track ${trackId} of ${path.basename(opts.inputBk2)}`,
      );
    }
    if (current !== opts.inputBk2) fs.rmSync(current, { force: true });
    current = out;
  }
};

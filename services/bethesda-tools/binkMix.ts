/**
 * BinkMix under 64-bit Wine: a sound track written into a Bink 2 video.
 *
 * `radvideo64.exe BinkMix <in> <sound> <out> /TrackID# …` rewrites one audio
 * track and leaves the picture alone, so a video with several language tracks
 * is mixed once per track, each pass reading the previous pass's output. RAD
 * ships the tool 64-bit only, so it runs in its own `win64` prefix beside the
 * 32-bit FaceFX / xWMA ones. It is a windowed program: without a display Wine
 * cannot create its window and the tool exits 0 having done nothing, so every
 * pass runs under `xvfb-run`; an error leaves a dialog waiting for a click, so
 * every pass runs under a timeout and counts only with exit code 0 and an
 * output file.
 *
 * The sound must be 16-bit PCM at a rate that fits Bink's 16-bit rate field:
 * a 192 kHz WAV mixes without a word of complaint and plays as silence.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { toWinePath } from './wineSlots';

const execFileAsync = promisify(execFile);

/**
 * Bink Audio compression level 0, the one Bethesda shipped: remixing the intro's own
 * English track gave 366.26 MB at level 0 against the original's 366.09 MB, 364.8 at
 * level 2 and 363.1 at level 4, and level 4 cut everything above 8 kHz by 10 dB.
 */
const SOUND_COMPRESS_LEVEL = 0;
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

/** The reason the game would not play this WAV once mixed in, or null when it would. */
export const binkSoundProblem = (wavPath: string): string | null => {
  const fmt = readWavFormat(wavPath);
  if (!fmt) return 'sound is not a RIFF/WAVE file';
  if (fmt.sampleRate > BINK_MAX_SAMPLE_RATE) {
    return `sound is ${fmt.sampleRate} Hz; Bink stores the rate in 16 bits, so it must be 48 kHz`;
  }
  if (
    fmt.bits !== 16 ||
    (fmt.formatTag !== WAVE_FORMAT_PCM && fmt.formatTag !== WAVE_FORMAT_EXTENSIBLE)
  ) {
    return `sound is not 16-bit PCM (format ${fmt.formatTag}, ${fmt.bits} bits)`;
  }
  return null;
};

export const parseTrackIds = (raw: unknown): number[] | null => {
  if (typeof raw !== 'string') return null;
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number.parseInt(s, 10));
  if (ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id < 0)) return null;
  return [...new Set(ids)];
};

export const binkMixArgs = (
  exe: string,
  inputBk2: string,
  soundWav: string,
  outputBk2: string,
  trackId: number,
): string[] => [
  exe,
  'BinkMix',
  toWinePath(inputBk2),
  toWinePath(soundWav),
  toWinePath(outputBk2),
  `/TrackID${trackId}`,
  `/SoundCompress${SOUND_COMPRESS_LEVEL}`,
  '/Overwrite',
  '/AutoClose',
];

/** One Wine invocation of the tool: `args` are what follows `wine`. */
export type BinkMixRunner = (args: string[], timeoutMs: number) => Promise<void>;

export type BinkMixTool = {
  wine: string;
  exe: string;
  env: NodeJS.ProcessEnv;
};

/** `xvfb-run -a wine <exe> …`: a throwaway X display per pass, killed with the pass. */
export const wineBinkMixRunner =
  (tool: BinkMixTool): BinkMixRunner =>
  async (args, timeoutMs) => {
    await execFileAsync('xvfb-run', ['-a', tool.wine, ...args], {
      env: tool.env,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
  };

export type ReplaceBinkTracksOptions = {
  exe: string;
  inputBk2: string;
  soundWav: string;
  outputBk2: string;
  /** Every id gets the same sound, so the game hears it whatever language it runs in. */
  trackIds: readonly number[];
  workDir: string;
  run: BinkMixRunner;
  timeoutMs: number;
};

/** Write `outputBk2` = `inputBk2` with `soundWav` on every listed track. */
export const replaceBinkTracks = async (opts: ReplaceBinkTracksOptions): Promise<void> => {
  if (opts.trackIds.length === 0) throw new Error('no track ids');
  const problem = binkSoundProblem(opts.soundWav);
  if (problem) throw new Error(problem);
  fs.mkdirSync(opts.workDir, { recursive: true });
  let current = opts.inputBk2;
  for (const [i, trackId] of opts.trackIds.entries()) {
    const last = i === opts.trackIds.length - 1;
    const out = last ? opts.outputBk2 : path.join(opts.workDir, `mix-${i}.bk2`);
    fs.rmSync(out, { force: true });
    await opts.run(binkMixArgs(opts.exe, current, opts.soundWav, out, trackId), opts.timeoutMs);
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
      throw new Error(`BinkMix left no output for track ${trackId}`);
    }
    if (current !== opts.inputBk2) fs.rmSync(current, { force: true });
    current = out;
  }
};

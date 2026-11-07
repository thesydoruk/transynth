/**
 * The ffmpeg calls the dub needs: cut a reference clip out of the speech
 * track, read a WAV's length, measure loudness, stretch a take, and mix the
 * takes over the background. Every call goes through one injectable runner so
 * the planning code can be tested without ffmpeg.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileAsync } from '../../utils/execFile';
import { resolveFfmpegPath } from '../../voice/voiceToolPaths';

export type FfmpegRunner = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

export const runFfmpeg: FfmpegRunner = (args) =>
  execFileAsync(resolveFfmpegPath(), ['-hide_banner', '-nostdin', ...args], {
    timeoutMs: 20 * 60_000,
  });

/** Mono 22.05 kHz 16-bit, the form the voice pipeline hands Fish Speech as a reference. */
export const cutReferenceClip = async (
  ffmpeg: FfmpegRunner,
  speechWav: string,
  fromS: number,
  toS: number,
  outWav: string,
): Promise<void> => {
  fs.mkdirSync(path.dirname(outWav), { recursive: true });
  await ffmpeg([
    '-y',
    '-v',
    'error',
    '-ss',
    fromS.toFixed(3),
    '-to',
    toS.toFixed(3),
    '-i',
    speechWav,
    '-ac',
    '1',
    '-ar',
    '22050',
    '-sample_fmt',
    's16',
    outWav,
  ]);
};

/** Integrated loudness (LUFS) of a file, from ffmpeg's loudnorm analysis pass. */
export const measureLoudness = async (
  ffmpeg: FfmpegRunner,
  wav: string,
): Promise<number | null> => {
  const { stderr } = await ffmpeg([
    '-v',
    'info',
    '-i',
    wav,
    '-af',
    'loudnorm=print_format=json',
    '-f',
    'null',
    '-',
  ]);
  return parseLoudnormJson(stderr);
};

/** The `input_i` of loudnorm's JSON block, or null when it is missing or "-inf". */
export const parseLoudnormJson = (stderr: string): number | null => {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    const parsed = JSON.parse(stderr.slice(start, end + 1)) as { input_i?: string };
    const value = Number(parsed.input_i);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
};

/** Speed a take up by `tempo` (> 1) without changing pitch. */
export const stretchTake = async (
  ffmpeg: FfmpegRunner,
  inWav: string,
  tempo: number,
  outWav: string,
): Promise<void> => {
  await ffmpeg(['-y', '-v', 'error', '-i', inWav, '-af', `atempo=${tempo.toFixed(4)}`, outWav]);
};

export type MixTake = { wav: string; startS: number };

/**
 * The filter graph of the mix: every take delayed to its start, summed as one
 * speech bus, brought to the loudness of the original narration, then laid
 * over the background. `amix` with `normalize=0` keeps every input's level.
 */
export const buildMixFilterGraph = (
  takes: readonly MixTake[],
  opts: { speechLufs: number | null; hasBackground: boolean },
): string => {
  const offset = opts.hasBackground ? 1 : 0;
  const lines: string[] = [];
  const labels: string[] = [];
  takes.forEach((take, i) => {
    const ms = Math.max(0, Math.round(take.startS * 1000));
    const label = `t${i}`;
    lines.push(
      `[${i + offset}:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo,adelay=${ms}|${ms}[${label}]`,
    );
    labels.push(`[${label}]`);
  });
  // loudnorm works at 192 kHz and hands that on; Bink keeps the rate in 16 bits,
  // so the bus goes back to 48 kHz before the mix.
  const loud =
    opts.speechLufs == null
      ? ''
      : `,loudnorm=I=${opts.speechLufs.toFixed(1)}:TP=-1.5:LRA=11,aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo`;
  if (takes.length === 1) lines.push(`${labels[0]}anull${loud}[speech]`);
  else
    lines.push(
      `${labels.join('')}amix=inputs=${takes.length}:normalize=0:dropout_transition=0${loud}[speech]`,
    );
  if (opts.hasBackground) {
    lines.push(
      `[0:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo[bg]`,
      `[bg][speech]amix=inputs=2:normalize=0:dropout_transition=0:duration=first[out]`,
    );
  } else {
    lines.push(`[speech]anull[out]`);
  }
  return lines.join(';\n');
};

/**
 * Write the mix: background (when present) plus the takes at their offsets →
 * 48 kHz 16-bit stereo WAV, the one form binkmix writes into a Bink 2 file
 * the game's own runtime plays.
 */
export const mixDubTrack = async (
  ffmpeg: FfmpegRunner,
  opts: {
    background: string | null;
    takes: readonly MixTake[];
    speechLufs: number | null;
    outWav: string;
    workDir: string;
  },
): Promise<void> => {
  if (opts.takes.length === 0) throw new Error('Nothing to mix: no takes');
  const graph = buildMixFilterGraph(opts.takes, {
    speechLufs: opts.speechLufs,
    hasBackground: opts.background != null,
  });
  fs.mkdirSync(opts.workDir, { recursive: true });
  const script = path.join(opts.workDir, 'mix.filter');
  fs.writeFileSync(script, graph);
  const inputs = [...(opts.background ? [opts.background] : []), ...opts.takes.map((t) => t.wav)];
  await ffmpeg([
    '-y',
    '-v',
    'error',
    ...inputs.flatMap((file) => ['-i', file]),
    '-filter_complex_script',
    script,
    '-map',
    '[out]',
    '-ar',
    '48000',
    '-c:a',
    'pcm_s16le',
    opts.outWav,
  ]);
};

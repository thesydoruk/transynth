/**
 * Put a sound track into a Bink video with RAD's mixer.
 *
 * `radvideo64.exe BinkMix <in> <sound> <out> /TrackID# …` rewrites one track
 * and leaves the picture alone, so a video with several language tracks is
 * mixed once per track, each pass reading the previous pass's output. The
 * mixer is a windowed tool: `/AutoClose` ends it on success, but an error
 * leaves a dialog waiting for a click, so every pass runs under a timeout and
 * counts only when it exits 0 and the output exists.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileAsync } from '../../utils/execFile';

/** Bink Audio quality 4: "best" in RAD's own scale (0 = biggest, 6 = very lossy). */
const SOUND_COMPRESS_LEVEL = 4;
const PASS_TIMEOUT_MS = 15 * 60_000;

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

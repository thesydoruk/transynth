/**
 * Write the finished dubs back into the videos and hand them to Vortex.
 *
 * The server's heartbeat reply names every video whose dub the agent has not
 * written yet. For each the agent downloads the track, replaces every audio
 * track of the game's own file with it (the picture is untouched) and keeps
 * the result under the agent's data folder. Once something was written the
 * whole folder becomes one archive — `Transynth_<game>_<lang>_videopack_r<N>.zip`
 * — in Vortex's downloads, a mod of its own next to the langpack: the videos
 * weigh gigabytes and change rarely.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GameMediaAdapter } from '../../games/contract';
import { zipDirectoryToPath } from '../../web/export/zipPack';
import type { VideoPackTask } from '../types';
import { replaceBinkTracks, type ReplaceBinkTracksOptions } from './binkMix';
import { probeVideo, resolveVideoSource } from './videoScan';

export type VideoPackApi = {
  downloadVideoDub: (game: string, videoId: number, destPath: string) => Promise<number>;
  postVideoPacked: (
    game: string,
    videoId: number,
    body: { dubVersion: string },
  ) => Promise<unknown>;
};

/** What the agent remembers between ticks about the videos it wrote. */
export type VideoPackState = {
  /** file name → the dub version written into it. */
  packedVideos: Record<string, string>;
  /** Number of the last videopack archive delivered. */
  videopackSeq: number;
};

export const videopackFileName = (game: string, tgtLang: string, seq: number): string =>
  `Transynth_${game}_${tgtLang}_videopack_r${seq}.zip`;

export type PackVideosOptions = {
  game: string;
  tgtLang: string;
  gameDir: string;
  media: GameMediaAdapter;
  tasks: readonly VideoPackTask[];
  api: VideoPackApi;
  radVideoExe: string;
  ffprobePath: string;
  /** Lower-case names of the videos deployed from our own videopack: those are mixed from Vortex's backup. */
  ownNames?: ReadonlySet<string>;
  /** The mod tree under construction: `<packDir>/<media.packDir>/<file>`. */
  packDir: string;
  downloadsDir: string;
  state: VideoPackState;
  mix?: (opts: ReplaceBinkTracksOptions) => Promise<void>;
  probe?: typeof probeVideo;
  zip?: typeof zipDirectoryToPath;
  log?: (line: string) => void;
};

export type PackVideosOutcome = { written: number; skipped: number; zipFile: string | null };

export const packVideos = async (opts: PackVideosOptions): Promise<PackVideosOutcome> => {
  const mix = opts.mix ?? replaceBinkTracks;
  const probe = opts.probe ?? probeVideo;
  const zip = opts.zip ?? zipDirectoryToPath;
  const outcome: PackVideosOutcome = { written: 0, skipped: 0, zipFile: null };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'transynth-videopack-'));
  const ownNames = opts.ownNames ?? new Set<string>();
  try {
    for (const task of opts.tasks) {
      if (opts.state.packedVideos[task.fileName] === task.dubVersion) {
        // Written already; the server asks again when it lost track of that (a re-registration).
        await opts.api.postVideoPacked(opts.game, task.videoId, { dubVersion: task.dubVersion });
        outcome.skipped += 1;
        continue;
      }
      const source = resolveVideoSource(
        path.join(opts.gameDir, opts.media.videoDir, task.fileName),
        ownNames,
      );
      if (!fs.existsSync(source)) {
        opts.log?.(`video ${task.fileName}: not in the game folder any more, skipped`);
        outcome.skipped += 1;
        continue;
      }
      const wav = path.join(work, `${task.videoId}.wav`);
      const bytes = await opts.api.downloadVideoDub(opts.game, task.videoId, wav);
      if (task.byteSize != null && bytes !== task.byteSize) {
        throw new Error(`dub of ${task.fileName} is ${bytes} bytes, server said ${task.byteSize}`);
      }
      const { tracks } = await probe(opts.ffprobePath, source);
      const trackIds = tracks.map((t) => t.id);
      if (trackIds.length === 0) throw new Error(`${task.fileName} has no audio track to replace`);
      const output = path.join(opts.packDir, opts.media.packDir, task.fileName);
      await mix({
        radVideoExe: opts.radVideoExe,
        inputBk2: source,
        soundWav: wav,
        outputBk2: output,
        trackIds,
        workDir: work,
      });
      fs.rmSync(wav, { force: true });
      opts.state.packedVideos[task.fileName] = task.dubVersion;
      outcome.written += 1;
      opts.log?.(`video ${task.fileName}: dub written into ${trackIds.length} track(s)`);
      await opts.api.postVideoPacked(opts.game, task.videoId, { dubVersion: task.dubVersion });
    }
    if (outcome.written > 0) {
      const seq = opts.state.videopackSeq + 1;
      const fileName = videopackFileName(opts.game, opts.tgtLang, seq);
      const dest = path.join(opts.downloadsDir, fileName);
      fs.mkdirSync(opts.downloadsDir, { recursive: true });
      await zip(opts.packDir, `${dest}.part`);
      fs.renameSync(`${dest}.part`, dest);
      opts.state.videopackSeq = seq;
      outcome.zipFile = fileName;
      opts.log?.(`videopack ${fileName} in Vortex downloads`);
    }
    return outcome;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
};

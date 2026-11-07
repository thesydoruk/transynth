/**
 * Hand the server the narration track of the videos it registered from the
 * agent's manifests: the heartbeat lists what is missing, the agent finds the
 * file by its hash in its own inventory, decodes the chosen track with ffmpeg
 * and uploads the WAV.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileAsync } from '../../utils/execFile';
import type { VideoUploadTask } from '../types';
import { pickSourceTrack, probeVideo } from './videoProbe';

export type VideoUploadApi = {
  putVideoAudio: (modId: number, videoId: number, wavPath: string) => Promise<void>;
};

/** Decode one Bink audio stream to 48 kHz stereo PCM WAV, the form the server expects. */
export const extractVideoTrack = async (
  ffmpegPath: string,
  absPath: string,
  streamIndex: number,
  outWav: string,
): Promise<void> => {
  fs.mkdirSync(path.dirname(outWav), { recursive: true });
  await execFileAsync(ffmpegPath, [
    '-y',
    '-v',
    'error',
    '-i',
    absPath,
    '-map',
    `0:${streamIndex}`,
    '-ac',
    '2',
    '-ar',
    '48000',
    '-c:a',
    'pcm_s16le',
    outWav,
  ]);
};

export type UploadVideoTracksOptions = {
  tasks: readonly VideoUploadTask[];
  /** The video file with this hash, from the agent's inventory; null when it is not there. */
  locate: (fingerprint: string) => string | null;
  api: VideoUploadApi;
  ffmpegPath: string;
  ffprobePath: string;
  /** Where the WAV is written before upload; a temp folder when unset. */
  workDir?: string;
  extract?: typeof extractVideoTrack;
  probe?: typeof probeVideo;
  log?: (line: string) => void;
};

export type VideoUploadOutcome = { uploaded: number; skipped: number };

export const uploadVideoTracks = async (
  opts: UploadVideoTracksOptions,
): Promise<VideoUploadOutcome> => {
  const extract = opts.extract ?? extractVideoTrack;
  const probe = opts.probe ?? probeVideo;
  const outcome: VideoUploadOutcome = { uploaded: 0, skipped: 0 };
  const workDir = opts.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'transynth-video-'));
  try {
    for (const task of opts.tasks) {
      const absPath = opts.locate(task.fingerprint);
      if (!absPath) {
        opts.log?.(`video ${task.fileName}: not in the inventory any more, skipped`);
        outcome.skipped += 1;
        continue;
      }
      const { tracks } = await probe(opts.ffprobePath, absPath);
      const track = pickSourceTrack(tracks, task.sourceTrackId ?? undefined);
      if (!track) {
        opts.log?.(`video ${task.fileName}: no audio track to upload, skipped`);
        outcome.skipped += 1;
        continue;
      }
      const wav = path.join(workDir, `${task.videoId}.wav`);
      try {
        await extract(opts.ffmpegPath, absPath, track.streamIndex, wav);
        await opts.api.putVideoAudio(task.modId, task.videoId, wav);
      } finally {
        fs.rmSync(wav, { force: true });
      }
      outcome.uploaded += 1;
      opts.log?.(`video ${task.fileName}: track ${track.id} uploaded as #${task.videoId}`);
    }
  } finally {
    if (!opts.workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }
  return outcome;
};

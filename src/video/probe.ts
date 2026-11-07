/**
 * What `ffprobe` says about a video, and the narration track decoded out of it.
 *
 * ffmpeg's `bink` demuxer reports every Bink audio track as a stream whose
 * `id` is the track id the game selects by language; the picture itself
 * cannot be decoded (Bink 2), which is fine — only the audio is needed here.
 * Both tools are the distro's, in the web and worker images.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileAsync } from '../utils/execFile';
import { resolveFfmpegPath, resolveFfprobePath } from '../voice/voiceToolPaths';

export type VideoTrack = { id: number; streamIndex: number };

export type VideoProbe = { durationS: number | null; tracks: VideoTrack[] };

/** `ffprobe -of json` output → duration and the audio tracks with their Bink ids. */
export const parseFfprobeJson = (text: string): VideoProbe => {
  const parsed = JSON.parse(text) as {
    format?: { duration?: string };
    streams?: Array<{ index?: number; id?: string; codec_type?: string }>;
  };
  const duration = Number(parsed.format?.duration);
  const tracks: VideoTrack[] = [];
  for (const stream of parsed.streams ?? []) {
    if (stream.codec_type !== 'audio' || typeof stream.index !== 'number') continue;
    const id = typeof stream.id === 'string' ? Number.parseInt(stream.id, 16) : NaN;
    tracks.push({ id: Number.isFinite(id) ? id : tracks.length, streamIndex: stream.index });
  }
  return { durationS: Number.isFinite(duration) ? duration : null, tracks };
};

export const probeVideo = async (absPath: string): Promise<VideoProbe> => {
  const { stdout } = await execFileAsync(resolveFfprobePath(), [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=index,id,codec_type',
    '-of',
    'json',
    absPath,
  ]);
  return parseFfprobeJson(stdout);
};

/** The narration: the game's preferred track id when the video has it, else the lowest. */
export const pickSourceTrack = (
  tracks: VideoTrack[],
  preferredId: number | undefined,
): VideoTrack | null => {
  if (tracks.length === 0) return null;
  const preferred = preferredId == null ? undefined : tracks.find((t) => t.id === preferredId);
  return preferred ?? tracks.reduce((best, t) => (t.id < best.id ? t : best));
};

/** Decode one Bink audio stream to 48 kHz stereo PCM WAV, the form separation and the dub expect. */
export const extractVideoTrack = async (
  absPath: string,
  streamIndex: number,
  outWav: string,
): Promise<void> => {
  fs.mkdirSync(path.dirname(outWav), { recursive: true });
  await execFileAsync(resolveFfmpegPath(), [
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

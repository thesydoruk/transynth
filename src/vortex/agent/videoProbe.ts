/**
 * What `ffprobe` says about a video, and the manifest the unit upload carries
 * in the video's place.
 *
 * ffmpeg's `bink` demuxer reports every Bink audio track as a stream whose
 * `id` is the track id the game selects by language; the video stream itself
 * cannot be decoded (Bink 2), which is fine — only the audio leaves this machine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileAsync } from '../../utils/execFile';
import type { VideoManifest } from '../../video/manifest';
import type { FileHasher } from '../hashSubset';

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

export const probeVideo = async (ffprobePath: string, absPath: string): Promise<VideoProbe> => {
  const { stdout } = await execFileAsync(ffprobePath, [
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

/** Pick the track to upload: the configured id when the video has it, else the lowest. */
export const pickSourceTrack = (
  tracks: VideoTrack[],
  preferredId: number | undefined,
): VideoTrack | null => {
  if (tracks.length === 0) return null;
  const preferred = preferredId == null ? undefined : tracks.find((t) => t.id === preferredId);
  return preferred ?? tracks.reduce((best, t) => (t.id < best.id ? t : best));
};

export type VideoDescriber = (absPath: string, fileName: string) => Promise<VideoManifest>;

/**
 * The manifest of one video: its size and hash (the inventory's own, through
 * the cache), what ffprobe says, and the narration track to upload.
 */
export const videoDescriber = (opts: {
  ffprobePath: string;
  hashFile: FileHasher;
  preferredTrackId?: number;
  agentKey?: string;
  probe?: typeof probeVideo;
}): VideoDescriber => {
  const probe = opts.probe ?? probeVideo;
  return async (absPath, fileName = path.basename(absPath)) => {
    const [sha1, probed] = await Promise.all([
      opts.hashFile(absPath),
      probe(opts.ffprobePath, absPath),
    ]);
    const source = pickSourceTrack(probed.tracks, opts.preferredTrackId);
    return {
      fileName,
      byteSize: fs.statSync(absPath).size,
      sha1,
      durationS: probed.durationS,
      trackIds: probed.tracks.map((t) => t.id).sort((a, b) => a - b),
      sourceTrackId: source?.id ?? null,
      ...(opts.agentKey ? { agentKey: opts.agentKey } : {}),
    };
  };
};

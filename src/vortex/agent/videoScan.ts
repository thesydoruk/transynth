/**
 * The cutscene videos in the game folder, as the agent sees them: which files,
 * a cheap fingerprint, and what `ffprobe` says about their audio tracks.
 *
 * ffmpeg's `bink` demuxer reports every Bink audio track as a stream whose
 * `id` is the track id the game selects by language; the video stream itself
 * cannot be decoded (Bink 2), which is fine — only the audio leaves this machine.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { GameMediaAdapter } from '../../games/contract';
import { execFileAsync } from '../../utils/execFile';
import { discoverVortexDeployment } from '../deploymentManifest';

export type VideoTrack = { id: number; streamIndex: number };

export type VideoProbe = { durationS: number | null; tracks: VideoTrack[] };

export type VideoScanEntry = {
  fileName: string;
  absPath: string;
  byteSize: number;
  fingerprint: string;
  durationS: number | null;
  trackIds: number[];
  /** The track uploaded as the source: the lowest id unless the config names one. */
  sourceTrackId: number;
  sourceStreamIndex: number;
};

const FINGERPRINT_HEAD_BYTES = 1024 * 1024;

/** Where Vortex keeps the game's own file while a mod's copy is deployed over it. */
export const VORTEX_BACKUP_SUFFIX = '.vortex_backup';

/** The staging folder of a videopack this agent delivered (`Transynth_<game>_<lang>_videopack_r<N>`). */
export const isVideopackFolder = (folder: string, game: string): boolean =>
  new RegExp(`^Transynth_${game}_[A-Za-z-]+_videopack_r\\d+$`, 'i').test(folder);

/**
 * The names of the video files Vortex currently deploys from one of our
 * videopacks, in lower case, from the deployment manifest in staging. Empty
 * when there is no manifest, which is also the case without Vortex.
 */
export const ownDeployedVideoNames = (
  stagingPath: string,
  game: string,
  media: GameMediaAdapter,
): Set<string> => {
  const names = new Set<string>();
  let deployment: ReturnType<typeof discoverVortexDeployment>;
  try {
    deployment = discoverVortexDeployment(stagingPath);
  } catch {
    return names;
  }
  for (const file of deployment?.files ?? []) {
    const name = path.basename(file.relPath);
    if (!media.videoExtensions.includes(path.extname(name).toLowerCase())) continue;
    if (isVideopackFolder(file.sourceFolder, game)) names.add(name.toLowerCase());
  }
  return names;
};

/**
 * The file a video is read from. Once Vortex has deployed our videopack, the
 * file in the game folder is the previous dub: read from it, the agent would
 * register its own output as a new video, forget the dub it came from, and mix
 * the next dub over a mixed track. Vortex keeps the game's own file next to it
 * as `<file>.vortex_backup`; that is the video.
 */
export const resolveVideoSource = (absPath: string, ownNames: ReadonlySet<string>): string => {
  if (!ownNames.has(path.basename(absPath).toLowerCase())) return absPath;
  const backup = `${absPath}${VORTEX_BACKUP_SUFFIX}`;
  return fs.existsSync(backup) ? backup : absPath;
};

/**
 * Size, mtime and the first MiB: enough to notice Vortex swapping the file,
 * without reading 400 MB per video on every scan.
 */
export const videoFingerprint = (absPath: string): { byteSize: number; fingerprint: string } => {
  const stat = fs.statSync(absPath);
  const fd = fs.openSync(absPath, 'r');
  try {
    const head = Buffer.alloc(Math.min(FINGERPRINT_HEAD_BYTES, stat.size));
    const read = fs.readSync(fd, head, 0, head.length, 0);
    const hash = crypto.createHash('sha1');
    hash.update(`${stat.size}|${Math.floor(stat.mtimeMs)}|`);
    hash.update(head.subarray(0, read));
    return { byteSize: stat.size, fingerprint: hash.digest('hex') };
  } finally {
    fs.closeSync(fd);
  }
};

/** The files of the game's video folder with a media extension, sorted by name. */
export const listVideoFiles = (gameDir: string, media: GameMediaAdapter): string[] => {
  const dir = path.join(gameDir, media.videoDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && media.videoExtensions.includes(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(dir, e.name))
    .sort((a, b) => a.localeCompare(b));
};

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

export type ScanVideosOptions = {
  gameDir: string;
  media: GameMediaAdapter;
  ffprobePath: string;
  preferredTrackId?: number;
  /** Lower-case names of the videos deployed from our own videopack (see `ownDeployedVideoNames`). */
  ownNames?: ReadonlySet<string>;
  probe?: (ffprobePath: string, absPath: string) => Promise<VideoProbe>;
};

/** Every video with at least one audio track; silent ones have nothing to dub. */
export const scanVideos = async (opts: ScanVideosOptions): Promise<VideoScanEntry[]> => {
  const probe = opts.probe ?? probeVideo;
  const entries: VideoScanEntry[] = [];
  const ownNames = opts.ownNames ?? new Set<string>();
  for (const deployed of listVideoFiles(opts.gameDir, opts.media)) {
    const absPath = resolveVideoSource(deployed, ownNames);
    const { durationS, tracks } = await probe(opts.ffprobePath, absPath);
    const source = pickSourceTrack(tracks, opts.preferredTrackId);
    if (!source) continue;
    const { byteSize, fingerprint } = videoFingerprint(absPath);
    entries.push({
      fileName: path.basename(deployed),
      absPath,
      byteSize,
      fingerprint,
      durationS,
      trackIds: tracks.map((t) => t.id).sort((a, b) => a - b),
      sourceTrackId: source.id,
      sourceStreamIndex: source.streamIndex,
    });
  }
  return entries;
};

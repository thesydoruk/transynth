/**
 * Where a video and its audio live on the server, under `PATHS.videoUploads`:
 *
 *   src/<fingerprint>/video<ext> | source.wav | speech.wav | background.wav | separation.json
 *   assets/<id>/dub_<lang>.wav, assets/<id>/takes/NNNN.wav, assets/<id>/<file name>
 *
 * What is derived from the file alone is keyed by the file's hash, so a new
 * version of the mod that ships the same video shares it; what depends on the
 * translation (takes, the dub, the dubbed video) is the asset's own.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PATHS } from '../paths';
import { execFileAsync } from '../utils/execFile';
import { ensureDir } from '../utils/file';
import { resolveFfmpegPath } from '../voice/voiceToolPaths';
import type { VideoAssetRow, VideoAudioKind } from './types';

type AssetKey = Pick<VideoAssetRow, 'id' | 'fingerprint'>;
type FileKey = Pick<VideoAssetRow, 'fingerprint' | 'file_name'>;

/** The video file itself, shared by every asset with the same hash. */
export const videoFileRelPath = (asset: FileKey): string =>
  path.join(videoSourceRelDir(asset), `video${path.extname(asset.file_name).toLowerCase()}`);

/** The video file on disk, or null until the agent uploaded it. */
export const videoFile = (asset: FileKey): string | null => {
  const file = resolveVideoAudioPath(videoFileRelPath(asset));
  return fs.existsSync(file) ? file : null;
};

/** The asset's own copy of the video with the dub written in, named as the game's file. */
export const videoPackedRelPath = (asset: Pick<VideoAssetRow, 'id' | 'file_name'>): string =>
  path.join(videoAssetRelDir(asset), asset.file_name);

export const videoPackedFile = (asset: Pick<VideoAssetRow, 'id' | 'file_name'>): string | null => {
  const file = resolveVideoAudioPath(videoPackedRelPath(asset));
  return fs.existsSync(file) ? file : null;
};

/**
 * Store the agent's upload of the video itself, hashed on the way in: a file
 * whose sha1 is not the asset's fingerprint is not the video the manifest
 * described and is dropped. Written under a temporary name and renamed last.
 */
export const storeVideoFile = async (
  asset: FileKey,
  stream: Readable,
): Promise<{ relPath: string; bytes: number }> => {
  const relPath = videoFileRelPath(asset);
  const dest = resolveVideoAudioPath(relPath);
  ensureDir(path.dirname(dest));
  const part = `${dest}.part`;
  const hash = crypto.createHash('sha1');
  const hashing = new Transform({
    transform(chunk: Buffer, _enc, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });
  try {
    await pipeline(stream, hashing, fs.createWriteStream(part));
    const sha1 = hash.digest('hex');
    if (sha1 !== asset.fingerprint) {
      throw new Error(
        `uploaded file hashes to ${sha1}, the registered video is ${asset.fingerprint}`,
      );
    }
  } catch (err) {
    fs.rmSync(part, { force: true });
    throw err;
  }
  fs.renameSync(part, dest);
  return { relPath, bytes: fs.statSync(dest).size };
};

/** The asset's own folder (takes, dub), relative to the uploads root. */
export const videoAssetRelDir = (asset: Pick<VideoAssetRow, 'id'>): string =>
  path.join('assets', String(asset.id));

export const videoAssetDir = (asset: Pick<VideoAssetRow, 'id'>): string =>
  path.join(PATHS.videoUploads, videoAssetRelDir(asset));

/** The folder shared by every asset of one video file. */
export const videoSourceRelDir = (asset: Pick<VideoAssetRow, 'fingerprint'>): string =>
  path.join('src', asset.fingerprint);

/** The relative path (as stored in the row) of one audio kind of an asset. */
export const videoAudioRelPath = (asset: AssetKey, kind: VideoAudioKind, tgtLang = 'uk'): string =>
  kind === 'dub'
    ? path.join(videoAssetRelDir(asset), `dub_${tgtLang}.wav`)
    : path.join(videoSourceRelDir(asset), `${kind}.wav`);

export const resolveVideoAudioPath = (relPath: string): string =>
  path.join(PATHS.videoUploads, relPath);

/**
 * Cut `[fromS, toS]` out of a WAV into a temporary file (the phrase players).
 * The caller removes the file once it is sent.
 */
export const sliceWavToTemp = async (file: string, fromS: number, toS: number): Promise<string> => {
  const out = path.join(
    os.tmpdir(),
    `transynth-slice-${process.pid}-${Date.now()}-${Math.round(fromS * 1000)}.wav`,
  );
  await execFileAsync(resolveFfmpegPath(), [
    '-y',
    '-v',
    'error',
    '-ss',
    fromS.toFixed(3),
    '-to',
    toS.toFixed(3),
    '-i',
    file,
    '-c:a',
    'pcm_s16le',
    out,
  ]);
  return out;
};

/** The on-disk file of one audio kind, or null when the asset has none yet. */
export const videoAudioFile = (
  asset: VideoAssetRow,
  kind: VideoAudioKind,
  tgtLang = 'uk',
): string | null => {
  let rel: string | null;
  if (kind === 'source') rel = asset.audio_rel_path;
  else if (kind === 'dub') rel = asset.dub_rel_path;
  else rel = asset.audio_rel_path ? videoAudioRelPath(asset, kind, tgtLang) : null;
  if (!rel) return null;
  const file = resolveVideoAudioPath(rel);
  return fs.existsSync(file) ? file : null;
};

/** Remove an asset's own folder (takes, dub); the shared source folder stays. */
export const removeVideoAssetFiles = (asset: Pick<VideoAssetRow, 'id'>): void => {
  fs.rmSync(videoAssetDir(asset), { recursive: true, force: true });
};

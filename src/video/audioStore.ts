/**
 * Where a video's audio lives on the server: one folder per asset under
 * `PATHS.videoUploads/<game>/<id>/`, one WAV per kind (`source.wav` from the
 * agent, `speech.wav` / `background.wav` from the separation, `dub_<lang>.wav`).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PATHS } from '../paths';
import { ensureDir } from '../utils/file';
import type { VideoAssetRow, VideoAudioKind } from './types';

export const videoAssetDir = (asset: Pick<VideoAssetRow, 'game' | 'id'>): string =>
  path.join(PATHS.videoUploads, asset.game, String(asset.id));

/** The relative path (as stored in the row) of one audio kind of an asset. */
export const videoAudioRelPath = (
  asset: Pick<VideoAssetRow, 'game' | 'id'>,
  kind: VideoAudioKind,
  tgtLang = 'uk',
): string => {
  const name = kind === 'dub' ? `dub_${tgtLang}.wav` : `${kind}.wav`;
  return path.join(asset.game, String(asset.id), name);
};

export const resolveVideoAudioPath = (relPath: string): string =>
  path.join(PATHS.videoUploads, relPath);

/**
 * Store the agent's upload as `source.wav`, written under a temporary name so a
 * broken connection never leaves a half file where the separation would read it.
 */
export const storeVideoSourceAudio = async (
  asset: Pick<VideoAssetRow, 'game' | 'id'>,
  stream: Readable,
): Promise<{ relPath: string; bytes: number }> => {
  const relPath = videoAudioRelPath(asset, 'source');
  const dest = resolveVideoAudioPath(relPath);
  ensureDir(path.dirname(dest));
  const part = `${dest}.part`;
  await pipeline(stream, fs.createWriteStream(part));
  fs.renameSync(part, dest);
  return { relPath, bytes: fs.statSync(dest).size };
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

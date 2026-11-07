/**
 * What the server does with a video file once it is on disk: read the tracks
 * out of it, decode the narration to `source.wav`, and move the asset on.
 *
 * Runs when the agent's upload lands and when the import registers an asset
 * whose file an earlier version already brought (the file is shared by hash).
 * An asset that already has its audio — the row predates the file upload, or
 * was carried over — keeps its state; only a dub without its dubbed video is
 * sent to be written again.
 */
import fs from 'node:fs';
import type { Tx } from '../db';
import { gamePlugin } from '../games/registry';
import { log } from '../logger';
import { resolveVideoAudioPath, videoAudioRelPath, videoFile, videoPackedFile } from './audioStore';
import { getVideoAsset, setVideoAssetAudio, setVideoAssetPacked, setVideoAssetProbe } from './db';
import { extractVideoTrack, pickSourceTrack, probeVideo } from './probe';
import type { VideoAssetRow } from './types';

export type IngestVideoOutcome = {
  trackIds: number[];
  sourceTrackId: number | null;
  /** The narration was decoded in this call. */
  decoded: boolean;
  /** The dub exists but its video does not: a pack job wants starting. */
  needsPack: boolean;
};

export const ingestVideoFile = async (
  db: Tx,
  asset: VideoAssetRow,
): Promise<IngestVideoOutcome> => {
  const file = videoFile(asset);
  if (!file)
    throw new Error(`Video #${asset.id} ${asset.file_name}: the file is not on the server`);
  const { rows: owner } = await db.query<{ game: string }>(`SELECT game FROM mods WHERE id = $1`, [
    asset.mod_id,
  ]);
  const media = owner[0] ? gamePlugin(owner[0].game).media : undefined;

  const probed = await probeVideo(file);
  const source = pickSourceTrack(probed.tracks, media?.narrationTrackId);
  const trackIds = probed.tracks.map((t) => t.id).sort((a, b) => a - b);
  await setVideoAssetProbe(db, asset.id, {
    durationS: probed.durationS,
    trackIds,
    sourceTrackId: source?.id ?? null,
  });

  let decoded = false;
  const sourceRel = videoAudioRelPath(asset, 'source');
  const hasAudio =
    asset.audio_rel_path != null && fs.existsSync(resolveVideoAudioPath(asset.audio_rel_path));
  if (!hasAudio && source) {
    await extractVideoTrack(file, source.streamIndex, resolveVideoAudioPath(sourceRel));
    await setVideoAssetAudio(db, asset.id, sourceRel);
    decoded = true;
  }

  // A dub recorded before the file reached the server has no video to show for it.
  let needsPack = false;
  const current = (await getVideoAsset(db, asset.id)) ?? asset;
  if (current.dub_rel_path && current.dub_version && !videoPackedFile(current)) {
    if (current.packed_version != null) await setVideoAssetPacked(db, current.id, null);
    needsPack = true;
  }
  log.info(
    `Video #${asset.id} ${asset.file_name}: ${trackIds.length} track(s), narration ${source?.id ?? 'none'}${decoded ? ', decoded' : ''}${needsPack ? ', dub waits for its video' : ''}`,
  );
  return { trackIds, sourceTrackId: source?.id ?? null, decoded, needsPack };
};

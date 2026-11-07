/**
 * Write a video's finished dub into the asset's own copy of the video.
 *
 * Bink 2 is written by RAD's tools alone, which run under Wine in
 * bethesda-tools (the `tools` pool): the video and the dub go there, the
 * mixed video comes back as `assets/<id>/<file name>` and `packed_version`
 * records which dub it carries. The group's videopack is built from these
 * copies; the game's own file is never touched.
 */
import fs from 'node:fs';
import type { Tx } from '../../db';
import { log } from '../../logger';
import { ensureDependencyHealthy } from '../../pipeline/waitForHealthy';
import { servicePool } from '../../services/pools';
import { resolveVideoAudioPath, videoFile, videoPackedRelPath } from '../audioStore';
import { getVideoAsset, setVideoAssetPacked, setVideoAssetStatus } from '../db';
import { binkMixViaRemote, type BinkMixRequest } from './binkMixClient';
import { assertBinkSound } from './wavFormat';

export type PackVideoOptions = {
  videoId: number;
  signal?: AbortSignal;
  /** The call to the tools host; the pool's own by default. */
  mix?: (req: BinkMixRequest) => Promise<number>;
};

export type PackVideoOutcome = { packedRelPath: string; dubVersion: string; bytes: number };

const poolMix = async (req: BinkMixRequest): Promise<number> => {
  const tools = servicePool('tools');
  if (tools.hosts().length === 0) {
    throw new Error('No bethesda-tools instance: none in the fleet and BETHESDA_TOOLS_URL unset');
  }
  await ensureDependencyHealthy('tools');
  return tools.run((host) => binkMixViaRemote(host, req));
};

export const packVideo = async (db: Tx, opts: PackVideoOptions): Promise<PackVideoOutcome> => {
  const asset = await getVideoAsset(db, opts.videoId);
  if (!asset) throw new Error(`Video #${opts.videoId} not found`);
  const video = videoFile(asset);
  if (!video)
    throw new Error(`Video #${asset.id} ${asset.file_name}: the file is not on the server`);
  if (!asset.dub_rel_path || !asset.dub_version) {
    throw new Error(`Video #${asset.id} ${asset.file_name}: no dub to write`);
  }
  const dub = resolveVideoAudioPath(asset.dub_rel_path);
  if (!fs.existsSync(dub)) throw new Error(`Video #${asset.id}: ${asset.dub_rel_path} is missing`);
  if (asset.track_ids.length === 0) {
    throw new Error(`Video #${asset.id} ${asset.file_name}: no audio track to replace`);
  }
  assertBinkSound(dub);

  await setVideoAssetStatus(db, asset.id, 'packing');
  const packedRelPath = videoPackedRelPath(asset);
  try {
    const bytes = await (opts.mix ?? poolMix)({
      videoPath: video,
      soundPath: dub,
      trackIds: asset.track_ids,
      outPath: resolveVideoAudioPath(packedRelPath),
    });
    if (opts.signal?.aborted) throw new Error('Pack cancelled');
    await setVideoAssetPacked(db, asset.id, asset.dub_version);
    log.info(
      `Video #${asset.id} ${asset.file_name}: dub ${asset.dub_version.slice(0, 12)} written into ${asset.track_ids.length} track(s), ${bytes} bytes`,
    );
    return { packedRelPath, dubVersion: asset.dub_version, bytes };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setVideoAssetStatus(db, asset.id, 'error', message);
    throw err;
  }
};

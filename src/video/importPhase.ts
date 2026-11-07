/**
 * The import phase for videos: the manifests the agent put into the upload
 * become assets of the mod, a video the previous version already had its
 * work carried over, and the phrases are (re)written as records so the
 * import's prune keeps them.
 */
import path from 'node:path';
import type { ModImportRunContext } from '../games/contract';
import { gamePlugin } from '../games/registry';
import { logImport } from '../logging/loggers';
import { videoFile } from './audioStore';
import { carryVideoAsset } from './carry';
import { findVideoCarrySource, getVideoAsset, registerVideoAsset } from './db';
import { ingestVideoFile } from './ingest';
import { isVideoManifestPath, listVideoManifests, readVideoManifest } from './manifest';
import { syncVideoRecords } from './videoRecords';

/**
 * The folder a mod's `Video/` sits in: beside a plugin anchor, two levels up
 * from a manifest anchor (`<dir>/Video/<file>.video.json`), else the given
 * mod directory.
 */
export const videoModDir = (anchorPath: string, modDir: string): string =>
  isVideoManifestPath(anchorPath) ? path.dirname(path.dirname(anchorPath)) : modDir;

export const importVideoManifests = async (
  ctx: ModImportRunContext,
  modDir: string,
): Promise<number> => {
  const media = gamePlugin(ctx.game).media;
  const modId = ctx.importModId;
  if (!media || modId == null) return 0;
  const manifests = listVideoManifests(videoModDir(ctx.anchorPath, modDir), media.videoDir);
  let registered = 0;
  for (const file of manifests) {
    if (ctx.state.cancel || ctx.state.pause) break;
    const manifest = readVideoManifest(file);
    if (!manifest) {
      logImport.warn(`[Mod Import #${ctx.job.id}] Unreadable video manifest ${file}`);
      continue;
    }
    let asset = await registerVideoAsset(ctx.db, modId, {
      fileName: manifest.fileName,
      byteSize: manifest.byteSize,
      fingerprint: manifest.sha1,
      agentKey: manifest.agentKey ?? null,
    });
    if (asset.status === 'registered' && !asset.audio_rel_path) {
      const from = await findVideoCarrySource(ctx.db, {
        fingerprint: asset.fingerprint,
        game: ctx.game,
        excludeModId: modId,
      });
      if (from) {
        await carryVideoAsset(ctx.db, from, asset, ctx.job.tgt_lang);
      } else if (videoFile(asset)) {
        // The file came with an earlier version nothing else carries from: read it again.
        await ingestVideoFile(ctx.db, asset);
      }
      asset = (await getVideoAsset(ctx.db, asset.id)) ?? asset;
    }
    const sync = await syncVideoRecords(ctx.db, asset, ctx.pluginStringLang, ctx.job.tgt_lang);
    if (ctx.pruneStaleImportData) {
      for (const key of sync.keptRecordKeys) ctx.keptImportRecordKeys.add(key);
      for (const id of sync.keptStringIds) ctx.keptImportStringIds.add(id);
    }
    registered += 1;
    logImport.info(
      `[Mod Import #${ctx.job.id}] Video ${asset.file_name} #${asset.id}: ${asset.status}, ${sync.stringIds.size} phrase(s)`,
    );
  }
  return registered;
};

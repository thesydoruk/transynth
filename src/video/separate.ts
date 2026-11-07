/**
 * Separate and transcribe one video's narration.
 *
 * audio-intel's batch lane splits the uploaded track into speech and
 * background and transcribes the speech with timestamps and speaker labels.
 * The speech and background tracks are kept next to the source (the dub needs
 * both), the transcript is merged into phrases, and the phrases become VIDEO
 * records of the mod the video belongs to, where they are translated like any
 * other text.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../db';
import {
  deleteSeparationJob,
  downloadSeparationFile,
  submitSeparation,
  waitForSeparation,
  type SeparationJob,
  type SeparationResult,
} from '../audioIntel/jobs';
import { log } from '../logger';
import { resolveVideoAudioPath, videoAudioRelPath } from './audioStore';
import { getVideoAsset, setVideoAssetStatus } from './db';
import { listVideoSegments, mergeSegmentsIntoPhrases, replaceVideoSegments } from './segments';
import type { VideoAssetRow, VideoAssetStatus } from './types';
import { syncVideoRecords } from './videoRecords';

export type SeparateVideoDeps = {
  submit: typeof submitSeparation;
  wait: typeof waitForSeparation;
  download: typeof downloadSeparationFile;
  remove: typeof deleteSeparationJob;
};

const defaultDeps: SeparateVideoDeps = {
  submit: submitSeparation,
  wait: waitForSeparation,
  download: downloadSeparationFile,
  remove: deleteSeparationJob,
};

export type SeparateVideoOptions = {
  videoId: number;
  srcLang: string;
  tgtLang: string;
  /**
   * Replace only the speech and background tracks: the phrases, their
   * translations and takes stay as they are (a better separation model, the
   * same transcript). A video without phrases is separated in full anyway.
   */
  keepPhrases?: boolean;
  signal?: AbortSignal;
  onStage?: (stage: string) => void;
};

/** The states that survive a tracks-only run; anything else ends as `separated`. */
/** The status a video with phrases is in once its dub and its packed copy are accounted for. */
const statusOfWork = (asset: VideoAssetRow): VideoAssetStatus => {
  if (asset.packed_version && asset.packed_version === asset.dub_version) return 'packed';
  return asset.dub_version ? 'dubbed' : 'separated';
};

export type SeparateVideoOutcome = { modId: number; phrases: number; speakers: number };

/** The transcript without the per-speaker embeddings, kept for inspection. */
const summarize = (result: SeparationResult): Record<string, unknown> => ({
  language: result.language,
  duration: result.duration,
  confidence: result.confidence,
  speakers: result.speakers.map(({ embedding: _e, ...rest }) => rest),
  overlaps: result.overlaps,
  dropped_segments: result.dropped_segments,
  elapsed_s: result.elapsed_s,
  segments: result.segments,
});

export const separateVideo = async (
  db: Tx,
  opts: SeparateVideoOptions,
  deps: SeparateVideoDeps = defaultDeps,
): Promise<SeparateVideoOutcome> => {
  const asset = await getVideoAsset(db, opts.videoId);
  if (!asset) throw new Error(`Video #${opts.videoId} not found`);
  if (!asset.audio_rel_path) throw new Error(`Video #${asset.id} has no uploaded audio yet`);
  const source = resolveVideoAudioPath(asset.audio_rel_path);
  if (!fs.existsSync(source)) throw new Error(`Video #${asset.id}: ${source} is missing`);

  await setVideoAssetStatus(db, asset.id, 'separating');
  let job: SeparationJob | null = null;
  try {
    opts.onStage?.('submitting');
    job = await deps.submit(source, { language: opts.srcLang, align: true, signal: opts.signal });
    const result = await deps.wait(job, {
      signal: opts.signal,
      onProgress: (current) => opts.onStage?.(current.stage || current.status),
    });
    if (!result.tracks.speech || !result.tracks.background) {
      throw new Error(`audio-intel returned no speech/background tracks for video #${asset.id}`);
    }

    opts.onStage?.('downloading');
    for (const [kind, name] of [
      ['speech', result.tracks.speech],
      ['background', result.tracks.background],
    ] as const) {
      await deps.download(job, name, resolveVideoAudioPath(videoAudioRelPath(asset, kind)));
    }
    const dir = path.dirname(source);
    fs.writeFileSync(path.join(dir, 'separation.json'), JSON.stringify(summarize(result), null, 2));

    opts.onStage?.('writing');
    const existing = opts.keepPhrases ? await listVideoSegments(db, asset.id, opts.tgtLang) : [];
    if (existing.length > 0) {
      // Tracks only: the transcript, the records and the takes are left alone. The route
      // has already written `separating`, so the status comes back from what is on disk.
      await setVideoAssetStatus(db, asset.id, statusOfWork(asset));
      log.info(
        `Video #${asset.id} ${asset.file_name}: tracks refreshed, ${existing.length} phrase(s) kept, ${result.elapsed_s ?? '?'} s on audio-intel`,
      );
      return { modId: asset.mod_id, phrases: existing.length, speakers: result.speakers.length };
    }
    const phrases = mergeSegmentsIntoPhrases(result.segments);
    await replaceVideoSegments(db, asset.id, phrases, new Map());
    await syncVideoRecords(db, asset, opts.srcLang, opts.tgtLang);
    await setVideoAssetStatus(db, asset.id, 'separated');
    log.info(
      `Video #${asset.id} ${asset.file_name}: ${phrases.length} phrase(s), ${result.speakers.length} speaker(s), ${result.elapsed_s ?? '?'} s on audio-intel`,
    );
    return { modId: asset.mod_id, phrases: phrases.length, speakers: result.speakers.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setVideoAssetStatus(db, asset.id, 'error', message);
    throw err;
  } finally {
    if (job) await deps.remove(job).catch(() => undefined);
  }
};

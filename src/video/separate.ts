/**
 * Separate and transcribe one video's narration.
 *
 * audio-intel's batch lane splits the uploaded track into speech and
 * background and transcribes the speech with timestamps and speaker labels.
 * The speech and background tracks are kept next to the source (the dub needs
 * both), the transcript is merged into phrases, and the phrases become the
 * records of the game's Video mod, where they are translated like any text.
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
import type { GameId } from '../types';
import { resolveVideoAudioPath, videoAudioRelPath } from './audioStore';
import { getVideoAsset, setVideoAssetStatus } from './db';
import { mergeSegmentsIntoPhrases, replaceVideoSegments } from './segments';
import { ensureVideoMod, writeVideoPhrasesToMod } from './videoMod';

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
  signal?: AbortSignal;
  onStage?: (stage: string) => void;
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
    const phrases = mergeSegmentsIntoPhrases(result.segments);
    const modId = await ensureVideoMod(db, asset.game as GameId);
    const stringIds = await writeVideoPhrasesToMod(
      db,
      {
        modId,
        videoId: asset.id,
        fileName: asset.file_name,
        srcLang: opts.srcLang,
        tgtLang: opts.tgtLang,
      },
      phrases,
    );
    await replaceVideoSegments(db, asset.id, phrases, stringIds);
    await db.query(
      `UPDATE video_assets SET mod_id = $2, status = 'separated', error = NULL, updated_at = NOW()
       WHERE id = $1`,
      [asset.id, modId],
    );
    log.info(
      `Video #${asset.id} ${asset.file_name}: ${phrases.length} phrase(s), ${result.speakers.length} speaker(s), ${result.elapsed_s ?? '?'} s on audio-intel`,
    );
    return { modId, phrases: phrases.length, speakers: result.speakers.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setVideoAssetStatus(db, asset.id, 'error', message);
    throw err;
  } finally {
    if (job) await deps.remove(job).catch(() => undefined);
  }
};

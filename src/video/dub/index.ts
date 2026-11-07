/**
 * Dub one video: a take per translated phrase, each fitted to its slot, mixed
 * over the separated background at the loudness of the original narration.
 *
 * `scope` says how much to synthesize: everything, only what changed since the
 * last run (a new translation, a moved phrase), or one phrase. The mix is
 * always rebuilt from every take the video has.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../db';
import { log } from '../../logger';
import { ttsPipelineConcurrency } from '../../tts/ttsRequestPool';
import { mapWithConcurrency } from '../../utils/concurrency';
import { sha1Hex } from '../../utils/hash';
import { wavDurationSec } from '../../voice/speakerReference/pcm';
import { loadVoiceProjectSettings } from '../../voice/voiceProjectSettings';
import {
  resolveVideoAudioPath,
  videoAssetDir,
  videoAssetRelDir,
  videoAudioFile,
  videoAudioRelPath,
} from '../audioStore';
import { getVideoAsset, setVideoAssetStatus } from '../db';
import { listVideoSegments, setSegmentFit, type VideoSegmentRow } from '../segments';
import { measureLoudness, mixDubTrack, runFfmpeg, stretchTake, type FfmpegRunner } from './ffmpeg';
import { synthesizeSegmentTake, takeTextOf, takeVersionOf } from './synthesize';
import { decideFit, planSlots } from './timeline';

export type DubScope = { kind: 'all' } | { kind: 'changed' } | { kind: 'segment'; idx: number };

/**
 * Part of the dub's version: a change to how the mix is written (its rate,
 * its format) must reach the game as a new dub even when no take changed.
 * 2: the mix went back to 48 kHz after loudnorm (the first mixes were 192 kHz,
 * which Bink's 16-bit rate field turned into silence in the game).
 */
const MIX_FORMAT_VERSION = 'mix2';

export const parseDubScope = (raw: unknown): DubScope | null => {
  if (raw == null || raw === 'changed') return { kind: 'changed' };
  if (raw === 'all') return { kind: 'all' };
  const m = /^segment:(\d+)$/.exec(String(raw));
  return m ? { kind: 'segment', idx: Number(m[1]) } : null;
};

export type DubVideoOptions = {
  videoId: number;
  tgtLang: string;
  scope: DubScope;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, stage: string) => void;
  ffmpeg?: FfmpegRunner;
  synthesize?: Parameters<typeof synthesizeSegmentTake>[1]['synthesize'];
};

export type DubVideoOutcome = {
  synthesized: number;
  takes: number;
  overruns: number;
  skipped: number;
  dubRelPath: string;
  dubVersion: string;
};

const needsTake = (seg: VideoSegmentRow, text: string, scope: DubScope): boolean => {
  if (scope.kind === 'segment') return seg.idx === scope.idx;
  if (scope.kind === 'all') return true;
  return !seg.take_rel_path || seg.take_version !== takeVersionOf(seg, text);
};

export const dubVideo = async (db: Tx, opts: DubVideoOptions): Promise<DubVideoOutcome> => {
  const ffmpeg = opts.ffmpeg ?? runFfmpeg;
  const asset = await getVideoAsset(db, opts.videoId);
  if (!asset) throw new Error(`Video #${opts.videoId} not found`);
  const speechWav = videoAudioFile(asset, 'speech');
  const backgroundWav = videoAudioFile(asset, 'background');
  if (!speechWav) throw new Error(`Video #${asset.id} has no speech track: separate it first`);

  await setVideoAssetStatus(db, asset.id, 'dubbing');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `transynth-dub-${asset.id}-`));
  try {
    const segments = await listVideoSegments(db, asset.id, opts.tgtLang);
    const { rows: owner } = await db.query<{ game: string }>(
      `SELECT game FROM mods WHERE id = $1`,
      [asset.mod_id],
    );
    const settings = await loadVoiceProjectSettings(db, owner[0]?.game ?? null);
    const assetDir = videoAssetDir(asset);
    const assetRelDir = videoAssetRelDir(asset);

    // 1. Takes for the phrases in scope that have something to say.
    const planned = segments
      .map((seg) => ({ seg, text: takeTextOf(seg) }))
      .filter((p): p is { seg: VideoSegmentRow; text: string } => p.text != null)
      .filter((p) => needsTake(p.seg, p.text, opts.scope));
    const total = planned.length;
    let done = 0;
    opts.onProgress?.(0, total, 'synthesizing');
    await mapWithConcurrency(
      planned,
      ttsPipelineConcurrency(),
      async ({ seg, text }) => {
        if (opts.signal?.aborted) return;
        await synthesizeSegmentTake(db, {
          asset,
          segments,
          seg,
          text,
          speechWav,
          assetDir,
          assetRelDir,
          workDir,
          synthesis: settings.synthesis,
          tgtLang: opts.tgtLang,
          ffmpeg,
          signal: opts.signal,
          synthesize: opts.synthesize,
        });
        done += 1;
        opts.onProgress?.(done, total, 'synthesizing');
      },
      { shouldAbort: () => opts.signal?.aborted === true },
    );
    if (opts.signal?.aborted) throw new Error('Dub cancelled');

    // 2. Every take the video has goes on the timeline, stretched into its slot when needed.
    opts.onProgress?.(done, total, 'fitting');
    const current = await listVideoSegments(db, asset.id, opts.tgtLang);
    const slots = new Map(planSlots(current, asset.duration_s).map((s) => [s.idx, s]));
    const placed: Array<{ wav: string; startS: number; version: string }> = [];
    let overruns = 0;
    for (const seg of current) {
      if (!seg.take_rel_path) continue;
      const takeWav = resolveVideoAudioPath(seg.take_rel_path);
      const slot = slots.get(seg.idx)!;
      const fit = decideFit(wavDurationSec(takeWav), slot);
      let wav = takeWav;
      if (fit.tempo > 1) {
        wav = path.join(workDir, `fit-${seg.idx}.wav`);
        await stretchTake(ffmpeg, takeWav, fit.tempo, wav);
      }
      await setSegmentFit(db, seg.id, { tempo: fit.tempo, overrun: fit.overrun });
      if (fit.overrun) overruns += 1;
      placed.push({ wav, startS: seg.start_s, version: `${seg.take_version}@${fit.tempo}` });
    }
    if (placed.length === 0) throw new Error(`Video #${asset.id}: no translated phrase to dub`);

    // 3. The mix, at the narration's loudness, over the background.
    opts.onProgress?.(done, total, 'mixing');
    const speechLufs = await measureLoudness(ffmpeg, speechWav);
    const dubRelPath = videoAudioRelPath(asset, 'dub', opts.tgtLang);
    const outWav = resolveVideoAudioPath(dubRelPath);
    await mixDubTrack(ffmpeg, {
      background: backgroundWav,
      takes: placed,
      speechLufs,
      outWav,
      workDir,
    });
    const dubVersion = sha1Hex([MIX_FORMAT_VERSION, ...placed.map((p) => p.version)].join('\n'));
    await db.query(
      `UPDATE video_assets
          SET dub_rel_path = $2, dub_version = $3, status = 'dubbed', error = NULL, updated_at = NOW()
        WHERE id = $1`,
      [asset.id, dubRelPath, dubVersion],
    );
    const outcome: DubVideoOutcome = {
      synthesized: done,
      takes: placed.length,
      overruns,
      skipped: segments.length - placed.length,
      dubRelPath,
      dubVersion,
    };
    log.info(
      `Video #${asset.id} ${asset.file_name}: dub ${outcome.takes} take(s), ${outcome.synthesized} new, ${outcome.overruns} overrun(s), loudness ${speechLufs ?? '?'} LUFS`,
    );
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setVideoAssetStatus(db, asset.id, 'error', message);
    throw err;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
};

/**
 * One take per translated phrase, cloned from the narration itself.
 *
 * The translation goes through the same text preparation as a game line
 * (stage directions and bracketed notes dropped), the references are cut from
 * the speech track, and Fish Speech makes the take under the project's retry
 * policy. Takes are stamped with what they were made from, so a later run
 * redoes only the phrases whose translation or slot changed.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import { synthesizeWav, type TtsReferenceInput } from '../../tts/ttsClient';
import type { TtsSynthesisParams } from '../../tts/ttsSynthesisParams';
import { sha1Hex } from '../../utils/hash';
import { stripVoiceNonSpeechBlocks } from '../../voice/prepareVoiceTtsText';
import { withLiveRetryPolicy } from '../../voice/voiceProjectSettings';
import { resolveTtsLanguage } from '../../voice/voiceToolPaths';
import { setSegmentTake, type VideoSegmentRow } from '../segments';
import { cutReferenceClip, type FfmpegRunner } from './ffmpeg';
import { pickSegmentReferences } from './references';

/** What a take depends on; a change in any of it makes the take stale. */
export const takeVersionOf = (seg: VideoSegmentRow, text: string): string =>
  sha1Hex(`${text}|${seg.start_s.toFixed(3)}|${seg.end_s.toFixed(3)}|${seg.speaker ?? ''}`);

/** The text Fish Speech should say for a segment, or null when there is nothing to say. */
export const takeTextOf = (seg: VideoSegmentRow): string | null => {
  if (!seg.translation || seg.translation_status === 'deleted') return null;
  const text = stripVoiceNonSpeechBlocks(seg.translation).replace(/\s+/g, ' ').trim();
  return text || null;
};

export type SynthesizeSegmentOptions = {
  asset: { id: number; duration_s: number | null };
  segments: readonly VideoSegmentRow[];
  seg: VideoSegmentRow;
  text: string;
  speechWav: string;
  /** Takes are written here as `takes/<idx>.wav`, relative paths stored as `assets/<id>/takes/…`. */
  assetDir: string;
  assetRelDir: string;
  workDir: string;
  synthesis: TtsSynthesisParams;
  tgtLang: string;
  ffmpeg: FfmpegRunner;
  signal?: AbortSignal;
  synthesize?: typeof synthesizeWav;
};

export type SynthesizedTake = { relPath: string; similarity: number | null; version: string };

export const synthesizeSegmentTake = async (
  db: Tx,
  opts: SynthesizeSegmentOptions,
): Promise<SynthesizedTake> => {
  const synthesize = opts.synthesize ?? synthesizeWav;
  const slices = pickSegmentReferences(opts.segments, opts.seg.idx, opts.asset.duration_s);
  const clips: TtsReferenceInput[] = [];
  for (const [i, slice] of slices.entries()) {
    const wavPath = path.join(opts.workDir, `ref-${opts.seg.idx}-${i}.wav`);
    await cutReferenceClip(opts.ffmpeg, opts.speechWav, slice.fromS, slice.toS, wavPath);
    clips.push({ wavPath, speakerText: slice.speakerText });
  }
  const synthesis = await withLiveRetryPolicy(db, opts.synthesis);
  const result = await synthesize(opts.text, clips, {
    language: resolveTtsLanguage(opts.tgtLang),
    synthesis,
    signal: opts.signal,
  });
  const fileName = `${String(opts.seg.idx).padStart(4, '0')}.wav`;
  fs.mkdirSync(path.join(opts.assetDir, 'takes'), { recursive: true });
  fs.writeFileSync(path.join(opts.assetDir, 'takes', fileName), result.wav);
  const take: SynthesizedTake = {
    relPath: path.join(opts.assetRelDir, 'takes', fileName),
    similarity: result.voiceSimilarity,
    version: takeVersionOf(opts.seg, opts.text),
  };
  await setSegmentTake(db, opts.seg.id, take);
  return take;
};

/**
 * The phrases of a video: what the transcription found, merged into units a
 * voice take can be made of, and the rows of `video_segments` that hold them.
 */
import type { AudioIntelSpeechSegment } from '../audioIntel/types';
import type { Tx } from '../db';

export type VideoPhrase = {
  idx: number;
  startS: number;
  endS: number;
  speaker: string | null;
  text: string;
};

export type MergeOptions = {
  /** A pause shorter than this joins two segments of one speaker (seconds). */
  maxGapS?: number;
  /** A merged phrase never grows past this (seconds). */
  maxLenS?: number;
};

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Whisper cuts at clause boundaries, often mid-sentence; a take per clause
 * makes choppy narration. Join consecutive segments of one speaker while the
 * pause between them is short and the result stays within the TTS reference
 * window; keep timestamps so each phrase still lands where the actor spoke.
 */
export const mergeSegmentsIntoPhrases = (
  segments: readonly AudioIntelSpeechSegment[],
  options: MergeOptions = {},
): VideoPhrase[] => {
  const maxGap = options.maxGapS ?? 0.4;
  const maxLen = options.maxLenS ?? 12;
  const sorted = [...segments].filter((s) => s.text.trim()).sort((a, b) => a.start - b.start);
  const phrases: VideoPhrase[] = [];
  for (const seg of sorted) {
    const speaker = seg.speaker ?? null;
    const last = phrases[phrases.length - 1];
    const joins =
      last != null &&
      last.speaker === speaker &&
      seg.start - last.endS <= maxGap &&
      seg.end - last.startS <= maxLen;
    if (joins) {
      last.endS = round3(Math.max(last.endS, seg.end));
      last.text = `${last.text} ${seg.text.trim()}`.replace(/\s+/g, ' ');
    } else {
      phrases.push({
        idx: phrases.length,
        startS: round3(seg.start),
        endS: round3(seg.end),
        speaker,
        text: seg.text.trim(),
      });
    }
  }
  return phrases;
};

export type VideoSegmentRow = {
  id: number;
  video_id: number;
  idx: number;
  start_s: number;
  end_s: number;
  speaker: string | null;
  source_text: string;
  string_id: number | null;
  take_rel_path: string | null;
  take_similarity: number | null;
  tempo: number | null;
  overrun: boolean;
  /** The current translation of the segment's string, when the mod has one. */
  translation: string | null;
  translation_status: string | null;
};

/** Replace a video's segments with the phrases of a fresh transcription. */
export const replaceVideoSegments = async (
  db: Tx,
  videoId: number,
  phrases: readonly VideoPhrase[],
  stringIds: ReadonlyMap<number, number>,
): Promise<void> => {
  await db.query(`DELETE FROM video_segments WHERE video_id = $1`, [videoId]);
  if (phrases.length === 0) return;
  await db.query(
    `INSERT INTO video_segments (video_id, idx, start_s, end_s, speaker, source_text, string_id)
     SELECT $1, idx, start_s, end_s, speaker, source_text, string_id
     FROM UNNEST($2::int[], $3::float8[], $4::float8[], $5::text[], $6::text[], $7::int[])
       AS u(idx, start_s, end_s, speaker, source_text, string_id)`,
    [
      videoId,
      phrases.map((p) => p.idx),
      phrases.map((p) => p.startS),
      phrases.map((p) => p.endS),
      phrases.map((p) => p.speaker),
      phrases.map((p) => p.text),
      phrases.map((p) => stringIds.get(p.idx) ?? null),
    ],
  );
};

export const listVideoSegments = async (
  db: Tx,
  videoId: number,
  tgtLang: string,
): Promise<VideoSegmentRow[]> => {
  const { rows } = await db.query<VideoSegmentRow>(
    `SELECT v.id, v.video_id, v.idx, v.start_s, v.end_s, v.speaker, v.source_text, v.string_id,
            v.take_rel_path, v.take_similarity, v.tempo, v.overrun,
            t.text AS translation, t.status AS translation_status
     FROM video_segments v
     LEFT JOIN translations t ON t.src_string_id = v.string_id AND t.target_lang = $2
     WHERE v.video_id = $1
     ORDER BY v.idx`,
    [videoId, tgtLang],
  );
  return rows;
};

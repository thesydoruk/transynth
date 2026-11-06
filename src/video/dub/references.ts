/**
 * Which pieces of the original narration a segment's take is cloned from.
 *
 * The first clip is the segment's own slice of the speech track: Fish Speech
 * fits the take's duration to the first reference (`match_timing`), so the
 * take lands in the actor's slot. More of the same speaker follows — the
 * nearest phrases in time — until the clips carry enough voice to clone.
 */
import {
  MAX_REFERENCE_DURATION_SEC,
  MIN_REFERENCE_DURATION_SEC,
  PREFERRED_REFERENCE_DURATION_MIN_SEC,
} from '../../voice/speakerReference/constants';
import type { VideoSegmentRow } from '../segments';

export type ReferenceSlice = {
  segmentId: number;
  fromS: number;
  toS: number;
  speakerText: string;
};

const MAX_EXTRA_CLIPS = 3;

type SegmentLike = Pick<
  VideoSegmentRow,
  'id' | 'idx' | 'start_s' | 'end_s' | 'speaker' | 'source_text'
>;

/** The segment's own slice, widened symmetrically when it is too short to be a reference. */
export const ownSlice = (seg: SegmentLike, totalS: number | null): ReferenceSlice => {
  let fromS = seg.start_s;
  let toS = seg.end_s;
  const missing = MIN_REFERENCE_DURATION_SEC - (toS - fromS);
  if (missing > 0) {
    fromS = Math.max(0, fromS - missing / 2);
    toS = fromS + MIN_REFERENCE_DURATION_SEC;
    if (totalS != null && toS > totalS) {
      toS = totalS;
      fromS = Math.max(0, toS - MIN_REFERENCE_DURATION_SEC);
    }
  }
  return { segmentId: seg.id, fromS, toS, speakerText: seg.source_text };
};

/**
 * The reference clips for one segment: its own slice first, then up to three
 * neighbouring phrases of the same speaker, nearest first, until the total
 * reaches the preferred reference length. Long phrases are left out — a clip
 * past the maximum slows synthesis without helping the clone.
 */
export const pickSegmentReferences = (
  segments: readonly SegmentLike[],
  idx: number,
  totalS: number | null,
): ReferenceSlice[] => {
  const seg = segments.find((s) => s.idx === idx);
  if (!seg) throw new Error(`No segment #${idx}`);
  const clips = [ownSlice(seg, totalS)];
  let total = clips[0]!.toS - clips[0]!.fromS;
  const neighbours = segments
    .filter((s) => s.idx !== idx && s.speaker === seg.speaker)
    .filter((s) => s.end_s - s.start_s >= MIN_REFERENCE_DURATION_SEC)
    .filter((s) => s.end_s - s.start_s <= MAX_REFERENCE_DURATION_SEC)
    .sort((a, b) => Math.abs(a.start_s - seg.start_s) - Math.abs(b.start_s - seg.start_s));
  for (const n of neighbours) {
    if (total >= PREFERRED_REFERENCE_DURATION_MIN_SEC || clips.length > MAX_EXTRA_CLIPS) break;
    clips.push({ segmentId: n.id, fromS: n.start_s, toS: n.end_s, speakerText: n.source_text });
    total += n.end_s - n.start_s;
  }
  return clips;
};

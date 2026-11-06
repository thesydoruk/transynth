/**
 * Where each take goes and how it is made to fit.
 *
 * A take has the slot from its phrase's start to just before the next phrase
 * (or the end of the video). A take longer than its slot is sped up, but never
 * by more than the listener forgives; what still does not fit is marked
 * `overrun` for the editor to shorten the translation.
 */
import type { VideoSegmentRow } from '../segments';

/** Silence kept between a take's end and the next phrase (seconds). */
export const SLOT_GAP_S = 0.15;
/** The most a take is sped up; past this narration sounds rushed. */
export const MAX_TEMPO = 1.15;
/** How far past its slot a take may run before it counts as an overrun. */
const OVERRUN_TOLERANCE_S = 0.05;

export type Slot = { idx: number; startS: number; endS: number };

type Timed = Pick<VideoSegmentRow, 'idx' | 'start_s' | 'end_s'>;

/** The slot of every phrase, in order; the last one ends with the video. */
export const planSlots = (segments: readonly Timed[], totalS: number | null): Slot[] => {
  const sorted = [...segments].sort((a, b) => a.idx - b.idx);
  return sorted.map((seg, i) => {
    const next = sorted[i + 1];
    const hardEnd = next ? next.start_s - SLOT_GAP_S : (totalS ?? seg.end_s + 60);
    return { idx: seg.idx, startS: seg.start_s, endS: Math.max(seg.start_s + 0.2, hardEnd) };
  });
};

export type FitDecision = {
  /** 1 when the take plays as made; above 1 it is sped up by this factor. */
  tempo: number;
  /** True when even the fastest allowed take runs past its slot. */
  overrun: boolean;
  /** Length of the take after the tempo change. */
  fittedS: number;
};

export const decideFit = (takeS: number, slot: Slot): FitDecision => {
  const slotS = slot.endS - slot.startS;
  if (takeS <= slotS + OVERRUN_TOLERANCE_S) return { tempo: 1, overrun: false, fittedS: takeS };
  const wanted = takeS / slotS;
  const tempo = Math.min(MAX_TEMPO, Math.round(wanted * 1000) / 1000);
  const fittedS = takeS / tempo;
  return { tempo, overrun: fittedS > slotS + OVERRUN_TOLERANCE_S, fittedS };
};

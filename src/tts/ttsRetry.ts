/**
 * Client-side retry policy for Fish Speech takes.
 *
 * xtts-engine returns one take per request with what it saw: a warning when
 * the take is silence or a cutoff, and the ECAPA cosine against the clone
 * prompt. The policy here decides whether that take is good enough and, when
 * several takes exist, which one to keep.
 */

export type TtsTake = {
  wav: Buffer;
  voiceSimilarity: number | null;
  /** `X-Synth-Warning`: silence or cutoff. Empty when the take is clean. */
  warning: string;
};

/** A take is retried when the server flagged it, or when its voice scored below `retryBelow`. */
export const takeNeedsRetry = (take: TtsTake, retryBelow: number): boolean => {
  if (take.warning) return true;
  return take.voiceSimilarity != null && take.voiceSimilarity < retryBelow;
};

const takeRank = (take: TtsTake): [number, number] => [
  take.warning ? 0 : 1,
  take.voiceSimilarity ?? -1,
];

/** Prefer a clean take; among equals, the strongest clone match; ties keep the earlier take. */
export const pickBestTake = <T extends TtsTake>(takes: readonly T[]): T => {
  if (takes.length === 0) throw new Error('No TTS takes to choose from');
  let best = takes[0];
  let bestRank = takeRank(best);
  for (const take of takes.slice(1)) {
    const rank = takeRank(take);
    if (rank[0] > bestRank[0] || (rank[0] === bestRank[0] && rank[1] > bestRank[1])) {
      best = take;
      bestRank = rank;
    }
  }
  return best;
};

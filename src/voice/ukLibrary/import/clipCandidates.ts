export const REF_MIN_DUR = 3.5;
export const REF_MAX_DUR = 10;
export const REF_TARGET_DUR = 6;
/** Max clips to fully analyze per speaker/voice. */
export const MAX_ANALYZE_CANDIDATES = 15;

export type ClipCandidate = {
  id: string;
  audioPath: string;
  durationSec: number | null;
  transcript: string;
  upVotes?: number;
};

const durationOk = (durationSec: number | null): boolean =>
  durationSec != null && durationSec >= REF_MIN_DUR && durationSec <= REF_MAX_DUR;

/** Rank candidates for analysis: prefer duration near 6s, then up-votes. */
export const pickAnalyzeCandidates = (candidates: ClipCandidate[]): ClipCandidate[] => {
  const eligible = candidates.filter((c) => durationOk(c.durationSec));
  const pool = eligible.length > 0 ? eligible : candidates;
  return [...pool]
    .sort((a, b) => {
      const da = Math.abs((a.durationSec ?? REF_TARGET_DUR) - REF_TARGET_DUR);
      const db = Math.abs((b.durationSec ?? REF_TARGET_DUR) - REF_TARGET_DUR);
      if (da !== db) return da - db;
      return (b.upVotes ?? 0) - (a.upVotes ?? 0);
    })
    .slice(0, MAX_ANALYZE_CANDIDATES);
};

/**
 * Monotone alignment of voice takes to lockit rows.
 *
 * Both sides are in the same order but one may be missing entries the other
 * has — an unvoiced line, a take with no row left in the catalogue. A global
 * Needleman–Wunsch over a similarity matrix finds where those gaps go without
 * ever crossing two pairs, which is the one thing that must hold: Articy ids
 * rise with entry ids, so a crossing pairing is always wrong.
 */

export type TakeLinePair = {
  /** Index into the takes array. */
  take: number;
  /** Index into the lines array. */
  line: number;
  /** Similarity that earned the pair, 0…1. */
  score: number;
};

export type AlignTakesOptions = {
  /**
   * Cost of leaving one side unpaired. A pair is only worth making when it
   * scores better than `1 - gapPenalty`, so this is the real decision knob.
   */
  gapPenalty: number;
  /** Pairs scoring below this are dropped: no text beats the wrong text. */
  minScore: number;
};

/**
 * Pair takes with lines, never crossing, gaps where either side has no partner.
 *
 * `scores[takeIndex][lineIndex]` is a similarity in 0…1.
 */
export const alignTakesToLines = (
  scores: readonly (readonly number[])[],
  options: AlignTakesOptions,
): TakeLinePair[] => {
  const takes = scores.length;
  const lines = takes > 0 ? scores[0]!.length : 0;
  if (takes === 0 || lines === 0) return [];

  const { gapPenalty, minScore } = options;
  const cost: Float64Array[] = [];
  /** 0 = pair, 1 = take without a line, 2 = line without a take. */
  const move: Int8Array[] = [];
  for (let i = 0; i <= takes; i++) {
    cost.push(new Float64Array(lines + 1));
    move.push(new Int8Array(lines + 1));
  }
  for (let i = 1; i <= takes; i++) {
    cost[i]![0] = cost[i - 1]![0]! + gapPenalty;
    move[i]![0] = 1;
  }
  for (let j = 1; j <= lines; j++) {
    cost[0]![j] = cost[0]![j - 1]! + gapPenalty;
    move[0]![j] = 2;
  }

  for (let i = 1; i <= takes; i++) {
    const row = scores[i - 1]!;
    for (let j = 1; j <= lines; j++) {
      const paired = cost[i - 1]![j - 1]! + (1 - (row[j - 1] ?? 0));
      const skipTake = cost[i - 1]![j]! + gapPenalty;
      const skipLine = cost[i]![j - 1]! + gapPenalty;
      if (paired <= skipTake && paired <= skipLine) {
        cost[i]![j] = paired;
        move[i]![j] = 0;
      } else if (skipTake <= skipLine) {
        cost[i]![j] = skipTake;
        move[i]![j] = 1;
      } else {
        cost[i]![j] = skipLine;
        move[i]![j] = 2;
      }
    }
  }

  const pairs: TakeLinePair[] = [];
  let i = takes;
  let j = lines;
  while (i > 0 || j > 0) {
    const step = i === 0 ? 2 : j === 0 ? 1 : move[i]![j]!;
    if (step === 0) {
      const score = scores[i - 1]![j - 1] ?? 0;
      if (score >= minScore) pairs.push({ take: i - 1, line: j - 1, score });
      i -= 1;
      j -= 1;
    } else if (step === 1) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return pairs.reverse();
};

/** Content words of a line, for comparing a transcript against lockit text. */
export const voiceMatchTokens = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);

/**
 * Dice overlap of two token bags, 0…1.
 *
 * Bag overlap rather than edit distance: a transcript and its lockit row differ
 * by punctuation, stage directions and whatever the speech model misheard, but
 * they share the words that were actually said.
 */
export const voiceMatchScore = (
  takeTokens: readonly string[],
  lineTokens: readonly string[],
): number => {
  if (takeTokens.length === 0 || lineTokens.length === 0) return 0;
  const remaining = new Map<string, number>();
  for (const word of takeTokens) remaining.set(word, (remaining.get(word) ?? 0) + 1);
  let shared = 0;
  for (const word of lineTokens) {
    const left = remaining.get(word) ?? 0;
    if (left > 0) {
      shared += 1;
      remaining.set(word, left - 1);
    }
  }
  return (2 * shared) / (takeTokens.length + lineTokens.length);
};

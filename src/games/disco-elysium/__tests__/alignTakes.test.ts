import { describe, expect, it } from '@jest/globals';
import { alignTakesToLines, voiceMatchScore, voiceMatchTokens } from '../voice/alignTakes';

const OPTIONS = { gapPenalty: 0.75, minScore: 0.3 };

/** Similarity matrix from plain strings, the way the ASR pass builds it. */
const scoresFor = (takes: string[], lines: string[]): number[][] => {
  const lineTokens = lines.map((line) => voiceMatchTokens(line));
  return takes.map((take) => {
    const takeTokens = voiceMatchTokens(take);
    return lineTokens.map((tokens) => voiceMatchScore(takeTokens, tokens));
  });
};

describe('voiceMatchScore', () => {
  it('scores a transcript against the line it came from', () => {
    const transcript = voiceMatchTokens("It's really there, spinning slowly, in absolute silence.");
    const line = voiceMatchTokens("It's really there. Spinning slowly -- in absolute silence.");
    expect(voiceMatchScore(transcript, line)).toBeGreaterThan(0.8);
  });

  it('ignores stage directions in brackets and short words', () => {
    expect(voiceMatchScore(voiceMatchTokens('Leave.'), voiceMatchTokens('[Leave.]'))).toBe(0);
  });

  it('is zero when one side has nothing to compare', () => {
    expect(voiceMatchScore([], voiceMatchTokens('Anything at all.'))).toBe(0);
  });
});

describe('alignTakesToLines', () => {
  it('pairs every take when both sides agree', () => {
    const pairs = alignTakesToLines(
      scoresFor(
        ['Kim lights a cigarette.', 'The door is locked.'],
        ['Kim lights a cigarette.', 'The door is locked.'],
      ),
      OPTIONS,
    );
    expect(pairs.map((p) => [p.take, p.line])).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('skips the line that has no take instead of shifting the rest', () => {
    const pairs = alignTakesToLines(
      scoresFor(
        ['Morning, detective.', 'The body is still hanging there.'],
        [
          'Morning, detective.',
          'Thought cabinet slot unlocked.',
          'The body is still hanging there.',
        ],
      ),
      OPTIONS,
    );
    expect(pairs.map((p) => [p.take, p.line])).toEqual([
      [0, 0],
      [1, 2],
    ]);
  });

  it('skips a take the catalogue has no line for', () => {
    const pairs = alignTakesToLines(
      scoresFor(
        ['Morning, detective.', 'Cut line nobody kept.', 'The body is still hanging there.'],
        ['Morning, detective.', 'The body is still hanging there.'],
      ),
      OPTIONS,
    );
    expect(pairs.map((p) => [p.take, p.line])).toEqual([
      [0, 0],
      [2, 1],
    ]);
  });

  it('never crosses two pairs', () => {
    const pairs = alignTakesToLines(
      scoresFor(
        ['The body is still hanging there.', 'Morning, detective.'],
        ['Morning, detective.', 'The body is still hanging there.'],
      ),
      OPTIONS,
    );
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i]!.line).toBeGreaterThan(pairs[i - 1]!.line);
    }
  });

  it('drops a pair nothing supports rather than guessing', () => {
    const pairs = alignTakesToLines(
      scoresFor(['Completely unrelated words here.'], ['Morning, detective.']),
      OPTIONS,
    );
    expect(pairs).toEqual([]);
  });

  it('returns nothing when either side is empty', () => {
    expect(alignTakesToLines([], OPTIONS)).toEqual([]);
    expect(alignTakesToLines([[]], OPTIONS)).toEqual([]);
  });
});

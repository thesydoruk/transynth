import { describe, expect, it } from '@jest/globals';
import { mergeSegmentsIntoPhrases } from '../segments';

const seg = (start: number, end: number, text: string, speaker?: string) => ({
  start,
  end,
  text,
  confidence: 0.9,
  ...(speaker ? { speaker } : {}),
});

describe('merging transcript segments into phrases', () => {
  it('joins clauses of one speaker across short pauses and keeps the timing', () => {
    const phrases = mergeSegmentsIntoPhrases([
      seg(0.5, 2.0, 'War.', 'SPEAKER_00'),
      seg(2.2, 4.1, 'War never changes.', 'SPEAKER_00'),
      seg(6.0, 8.0, 'The Romans waged war', 'SPEAKER_00'),
      seg(8.1, 9.5, 'to gather slaves and wealth.', 'SPEAKER_00'),
    ]);
    expect(phrases).toEqual([
      { idx: 0, startS: 0.5, endS: 4.1, speaker: 'SPEAKER_00', text: 'War. War never changes.' },
      {
        idx: 1,
        startS: 6,
        endS: 9.5,
        speaker: 'SPEAKER_00',
        text: 'The Romans waged war to gather slaves and wealth.',
      },
    ]);
  });

  it('never joins across speakers, and caps a phrase at the reference window', () => {
    const phrases = mergeSegmentsIntoPhrases(
      [
        seg(0, 5, 'One', 'A'),
        seg(5.1, 10, 'two', 'A'),
        seg(10.1, 14, 'three', 'A'),
        seg(14.1, 15, 'Four', 'B'),
      ],
      { maxLenS: 12 },
    );
    expect(phrases.map((p) => [p.speaker, p.text, p.startS, p.endS])).toEqual([
      ['A', 'One two', 0, 10],
      ['A', 'three', 10.1, 14],
      ['B', 'Four', 14.1, 15],
    ]);
  });

  it('drops empty segments, sorts by start and treats missing speakers alike', () => {
    const phrases = mergeSegmentsIntoPhrases([
      seg(3, 4, 'later'),
      seg(0, 1, '   '),
      seg(1, 2.9, 'earlier'),
    ]);
    expect(phrases).toEqual([{ idx: 0, startS: 1, endS: 4, speaker: null, text: 'earlier later' }]);
  });
});

import { describe, expect, it } from '@jest/globals';
import { ownSlice, pickSegmentReferences } from '../references';

const seg = (idx: number, start: number, end: number, speaker = 'A') => ({
  id: 100 + idx,
  idx,
  start_s: start,
  end_s: end,
  speaker,
  source_text: `phrase ${idx}`,
});

describe('segment references', () => {
  it('starts with the phrase itself, widened when it is too short to clone from', () => {
    expect(ownSlice(seg(0, 5, 9), 60)).toEqual({
      segmentId: 100,
      fromS: 5,
      toS: 9,
      speakerText: 'phrase 0',
    });
    const short = ownSlice(seg(1, 5, 5.5), 60);
    expect(short.toS - short.fromS).toBeCloseTo(1.2, 3);
    expect(short.fromS).toBeCloseTo(4.65, 3);
    // At the very end of the video the widening goes backwards instead.
    const tail = ownSlice(seg(2, 59.6, 60), 60);
    expect(tail).toMatchObject({ fromS: 58.8, toS: 60 });
  });

  it('adds the nearest phrases of the same speaker until the clone has enough voice', () => {
    const segments = [
      seg(0, 0, 3),
      seg(1, 4, 6),
      seg(2, 8, 10, 'B'),
      seg(3, 12, 15),
      seg(4, 20, 23),
      seg(5, 30, 50), // longer than a reference may be
      seg(6, 60, 60.5), // too short to be one
    ];
    // 3 s own + 2 s + 3 s reaches the preferred 8 s, so the farthest phrase is not needed.
    const clips = pickSegmentReferences(segments, 3, 70);
    expect(clips.map((c) => c.segmentId)).toEqual([103, 101, 104]);
    expect(clips[0]).toMatchObject({ fromS: 12, toS: 15, speakerText: 'phrase 3' });
  });

  it('stops once the preferred length is reached, and never mixes speakers', () => {
    const segments = [seg(0, 0, 6), seg(1, 7, 13), seg(2, 14, 20), seg(3, 21, 27, 'B')];
    expect(pickSegmentReferences(segments, 0, 30).map((c) => c.segmentId)).toEqual([100, 101]);
    expect(pickSegmentReferences(segments, 3, 30).map((c) => c.segmentId)).toEqual([103]);
  });
});

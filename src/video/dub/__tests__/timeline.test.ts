import { describe, expect, it } from '@jest/globals';
import { MAX_TEMPO, decideFit, planSlots } from '../timeline';

describe('dub timeline', () => {
  const segs = [
    { idx: 0, start_s: 1, end_s: 3 },
    { idx: 1, start_s: 3.5, end_s: 6 },
    { idx: 2, start_s: 10, end_s: 12 },
  ];

  it('gives every phrase the time up to the next one, the last one up to the end', () => {
    expect(planSlots(segs, 20)).toEqual([
      { idx: 0, startS: 1, endS: 3.35 },
      { idx: 1, startS: 3.5, endS: 9.85 },
      { idx: 2, startS: 10, endS: 20 },
    ]);
    // Unknown video length: the last slot is open-ended rather than clipped.
    expect(planSlots(segs, null)[2]!.endS).toBeGreaterThan(60);
  });

  it('keeps a take that fits, speeds up one that does not, and flags what cannot fit', () => {
    const slot = { idx: 0, startS: 0, endS: 2 };
    expect(decideFit(1.8, slot)).toEqual({ tempo: 1, overrun: false, fittedS: 1.8 });
    expect(decideFit(2.04, slot)).toEqual({ tempo: 1, overrun: false, fittedS: 2.04 });
    expect(decideFit(2.2, slot)).toEqual({ tempo: 1.1, overrun: false, fittedS: 2 });
    const far = decideFit(3, slot);
    expect(far.tempo).toBe(MAX_TEMPO);
    expect(far.overrun).toBe(true);
    expect(far.fittedS).toBeCloseTo(3 / MAX_TEMPO, 3);
  });
});

import { describe, expect, it } from '@jest/globals';
import { BATCH_CHAR_CAP, packUnits, reviewLineCount, windowUnit } from '../pack';
import type { ReviewUnit } from '../types';

const unit = (id: string, count: number, srcLength = 10): ReviewUnit => ({
  unit_id: id,
  kind: 'conversation',
  lines: Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    kind: 'response',
    src: 'x'.repeat(srcLength),
    tr: 'х',
  })),
});

describe('windowUnit', () => {
  it('leaves a unit that fits alone', () => {
    expect(windowUnit(unit('q', 140), 'dialog')).toHaveLength(1);
  });

  it('cuts a long conversation into windows with neighbours as context', () => {
    const windows = windowUnit(unit('q', 300), 'dialog');

    expect(windows.map((w) => w.unit_id)).toEqual(['q#1', 'q#2', 'q#3']);
    expect(windows.map((w) => reviewLineCount([w]))).toEqual([110, 110, 80]);
    // Every line is reviewed exactly once across the windows.
    expect(windows.reduce((n, w) => n + reviewLineCount([w]), 0)).toBe(300);
    expect(windows[1]!.lines[0]!.context_only).toBe(true);
    expect(windows[1]!.lines[6]!.context_only).toBeUndefined();
  });
});

describe('packUnits', () => {
  it('fills a batch up to the target without splitting units', () => {
    const batches = packUnits([unit('a', 60), unit('b', 60), unit('c', 60)], 'dialog');

    expect(batches.map((b) => b.map((u) => u.unit_id))).toEqual([['a', 'b'], ['c']]);
  });

  it('starts a new batch before the hard limit', () => {
    const batches = packUnits([unit('a', 100), unit('b', 60)], 'dialog');

    expect(batches).toHaveLength(2);
  });

  it('caps a batch by source characters, for long prose', () => {
    const page = BATCH_CHAR_CAP / 2 + 1;
    const batches = packUnits(
      [unit('a', 1, page), unit('b', 1, page), unit('c', 1, page)],
      'prose',
    );

    expect(batches.map((b) => b.length)).toEqual([1, 1, 1]);
  });
});

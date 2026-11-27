import { describe, expect, it } from '@jest/globals';
import { measureTakesInChunks, type MeasuredTake } from '../measureTakesInChunks';
import type { EffortFeatures } from '../vocalEffort';

const FEATURES: EffortFeatures = { f0MedianSt: 20, brightnessDb: -5, voicedRatio: 0.7 };

const pendingOf = (count: number): Array<[string, number]> =>
  Array.from({ length: count }, (_, i) => [`take-${i}`, i] as [string, number]);

describe('measureTakesInChunks', () => {
  it('saves every chunk before the next one starts', async () => {
    const saved: string[][] = [];
    const order: string[] = [];
    const result = await measureTakesInChunks({
      pending: pendingOf(5),
      workers: 2,
      chunkSize: 2,
      measure: async (take) => {
        order.push(`measure ${take}`);
        return take === 3 ? null : FEATURES;
      },
      save: async (chunk: ReadonlyArray<MeasuredTake<number>>) => {
        order.push('save');
        saved.push(chunk.map((item) => item.key).sort());
      },
    });

    expect(saved).toEqual([['take-0', 'take-1'], ['take-2', 'take-3'], ['take-4']]);
    expect(order.filter((step) => step === 'save')).toHaveLength(3);
    expect(order.indexOf('measure 2')).toBeGreaterThan(order.indexOf('save'));
    expect(result.measured).toBe(5);
    expect(result.failed).toBe(0);
    expect(result.cancelled).toBe(false);
    // Too little speech is a measurement too: remembered as null, not retried.
    expect(result.features.get('take-3')).toBeNull();
    expect(result.features.get('take-4')).toEqual(FEATURES);
  });

  it('counts a take that cannot be decoded as failed and leaves it unsaved', async () => {
    const saved: string[] = [];
    const handled: number[] = [];
    const result = await measureTakesInChunks({
      pending: pendingOf(3),
      workers: 1,
      chunkSize: 10,
      measure: async (take) => {
        if (take === 1) throw new Error('not a FUZ file');
        return FEATURES;
      },
      save: async (chunk) => {
        saved.push(...chunk.map((item) => item.key));
      },
      onTake: (count) => handled.push(count),
    });

    expect(result).toMatchObject({ measured: 2, failed: 1, cancelled: false });
    expect(saved).toEqual(['take-0', 'take-2']);
    expect(result.features.has('take-1')).toBe(false);
    expect(handled).toEqual([1, 2, 3]);
  });

  it('stops claiming takes on a stop and still saves what it measured', async () => {
    let stop = false;
    const saved: string[] = [];
    const result = await measureTakesInChunks({
      pending: pendingOf(6),
      workers: 1,
      chunkSize: 4,
      shouldCancel: () => stop,
      measure: async (take) => {
        if (take === 1) stop = true;
        return FEATURES;
      },
      save: async (chunk) => {
        saved.push(...chunk.map((item) => item.key));
      },
    });

    expect(saved).toEqual(['take-0', 'take-1']);
    expect(result).toMatchObject({ measured: 2, failed: 0, cancelled: true });
  });

  it('does nothing when there is nothing left to measure', async () => {
    let saves = 0;
    const result = await measureTakesInChunks({
      pending: [],
      workers: 4,
      chunkSize: 500,
      measure: async () => FEATURES,
      save: async () => {
        saves += 1;
      },
    });
    expect(saves).toBe(0);
    expect(result).toMatchObject({ measured: 0, failed: 0, cancelled: false });
  });
});

import { describe, it, expect } from '@jest/globals';
import { mapWithConcurrency, runPoolOverAsyncIterable } from '../concurrency';

async function* allAtOnce(items: number[]): AsyncGenerator<number> {
  for (const item of items) yield item;
}

describe('mapWithConcurrency', () => {
  it('stops claiming new items when shouldAbort flips', async () => {
    let abort = false;
    const started: number[] = [];

    const results = await mapWithConcurrency(
      [1, 2, 3, 4, 5, 6],
      2,
      async (item) => {
        started.push(item);
        if (item === 2) abort = true;
        await new Promise((r) => setTimeout(r, 20));
        return item * 10;
      },
      { shouldAbort: () => abort },
    );

    expect(started.length).toBeLessThan(6);
    expect(results.filter((r) => r != null).every((r) => typeof r === 'number')).toBe(true);
  });
});

describe('runPoolOverAsyncIterable', () => {
  it('does not block fast items behind one slow worker', async () => {
    const order: number[] = [];
    const started = Date.now();

    await runPoolOverAsyncIterable(allAtOnce([1, 2, 3]), 2, async (item) => {
      if (item === 2) await new Promise((r) => setTimeout(r, 80));
      order.push(item);
    });

    expect(order).toEqual([1, 3, 2]);
    expect(Date.now() - started).toBeLessThan(150);
  });
});

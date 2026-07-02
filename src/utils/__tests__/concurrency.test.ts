import { describe, it, expect } from '@jest/globals';
import { runPoolOverAsyncIterable } from '../concurrency';

async function* allAtOnce(items: number[]): AsyncGenerator<number> {
  for (const item of items) yield item;
}

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

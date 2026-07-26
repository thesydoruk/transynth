import { describe, it, expect } from '@jest/globals';
import { TtsRequestPool } from '../ttsRequestPool';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('TtsRequestPool', () => {
  it('limits concurrent requests', async () => {
    const pool = new TtsRequestPool(2);
    let inFlight = 0;
    let max = 0;

    const task = () =>
      pool.run(async () => {
        inFlight++;
        max = Math.max(max, inFlight);
        await tick();
        inFlight--;
      });

    await Promise.all([task(), task(), task()]);
    expect(max).toBeLessThanOrEqual(2);
  });

  it('updates limit at runtime via syncLimit', () => {
    const pool = new TtsRequestPool(1);
    pool.syncLimit(3);
    expect(pool.maxParallel).toBe(3);
    expect(pool.pipelineConcurrency()).toBe(4);
  });

  it('exposes pool stats', () => {
    const pool = new TtsRequestPool(5);
    expect(pool.stats.max).toBe(5);
  });
});

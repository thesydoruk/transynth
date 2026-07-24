import { describe, it, expect } from '@jest/globals';
import { TtsRequestPool } from '../ttsRequestPool';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('TtsRequestPool', () => {
  it('limits concurrent requests per backend independently', async () => {
    const pool = new TtsRequestPool({ xtts: 2, 'fish-speech': 1 });
    let xttsInFlight = 0;
    let xttsMax = 0;
    let fishInFlight = 0;
    let fishMax = 0;

    const xttsTask = () =>
      pool.run('xtts', async () => {
        xttsInFlight++;
        xttsMax = Math.max(xttsMax, xttsInFlight);
        await tick();
        xttsInFlight--;
      });

    const fishTask = () =>
      pool.run('fish-speech', async () => {
        fishInFlight++;
        fishMax = Math.max(fishMax, fishInFlight);
        await tick();
        fishInFlight--;
      });

    await Promise.all([xttsTask(), xttsTask(), xttsTask(), fishTask(), fishTask()]);
    expect(xttsMax).toBeLessThanOrEqual(2);
    expect(fishMax).toBeLessThanOrEqual(1);
  });

  it('updates limits at runtime via syncLimits', async () => {
    const pool = new TtsRequestPool({ xtts: 1, 'fish-speech': 1 });
    pool.syncLimits({ xtts: 3, 'fish-speech': 1 });
    expect(pool.maxParallel('xtts')).toBe(3);
    expect(pool.pipelineConcurrency('xtts')).toBe(4);
  });

  it('defaults missing backend to xtts slot', async () => {
    const pool = new TtsRequestPool({ xtts: 1, 'fish-speech': 4 });
    expect(pool.maxParallel(undefined)).toBe(1);
    expect(pool.pipelineConcurrency(undefined)).toBe(2);
  });

  it('exposes per-backend stats', () => {
    const pool = new TtsRequestPool({ xtts: 3, 'fish-speech': 5 });
    expect(pool.stats.xtts.max).toBe(3);
    expect(pool.stats['fish-speech'].max).toBe(5);
  });
});

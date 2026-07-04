import { describe, it, expect } from '@jest/globals';
import { MultiServerChatPool } from '../multiServerChatPool';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('MultiServerChatPool', () => {
  it('limits concurrency per server', async () => {
    const pool = new MultiServerChatPool([
      { host: 'http://a', maxParallel: 1, apiKey: '' },
      { host: 'http://b', maxParallel: 1, apiKey: '' },
    ]);

    const hosts: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const task = (label: string) =>
      pool.run(async (client, meta) => {
        hosts.push(meta.host);
        expect(client).toBeDefined();
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await tick();
        inFlight--;
        return label;
      });

    await Promise.all([task('1'), task('2'), task('3'), task('4')]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(new Set(hosts).size).toBeGreaterThan(1);
  });
});

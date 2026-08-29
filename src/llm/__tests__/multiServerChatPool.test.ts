import { describe, it, expect } from '@jest/globals';
import { MultiServerChatPool } from '../multiServerChatPool';
import { NoHealthyVllmServerError } from '../vllmServerHealth';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('MultiServerChatPool', () => {
  it('limits concurrency per server', async () => {
    const pool = new MultiServerChatPool(
      [
        { host: 'http://a', maxParallel: 1, apiKey: '' },
        { host: 'http://b', maxParallel: 1, apiKey: '' },
      ],
      { healthIntervalMs: 0, probe: async () => true },
    );

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
    pool.dispose();
  });

  it('skips unhealthy servers until the probe recovers them', async () => {
    const health = new Map<string, boolean>([
      ['http://a', false],
      ['http://b', true],
    ]);
    const pool = new MultiServerChatPool(
      [
        { host: 'http://a', maxParallel: 2, apiKey: '' },
        { host: 'http://b', maxParallel: 2, apiKey: '' },
      ],
      {
        healthIntervalMs: 0,
        probe: async (host) => health.get(host) ?? false,
      },
    );

    await pool.runHealthChecks();
    const hosts: string[] = [];
    await Promise.all(
      Array.from({ length: 4 }, () =>
        pool.run(async (_client, meta) => {
          hosts.push(meta.host);
        }),
      ),
    );
    expect(hosts.every((host) => host === 'http://b')).toBe(true);

    health.set('http://a', true);
    await pool.runHealthChecks();
    const after: string[] = [];
    await Promise.all(
      Array.from({ length: 6 }, () =>
        pool.run(async (_client, meta) => {
          after.push(meta.host);
        }),
      ),
    );
    expect(new Set(after)).toEqual(new Set(['http://a', 'http://b']));
    pool.dispose();
  });

  it('throws when every server fails health checks', async () => {
    const pool = new MultiServerChatPool(
      [
        { host: 'http://a', maxParallel: 1, apiKey: '' },
        { host: 'http://b', maxParallel: 1, apiKey: '' },
      ],
      { healthIntervalMs: 0, probe: async () => false },
    );
    await pool.runHealthChecks();
    await expect(pool.run(async () => 'x')).rejects.toBeInstanceOf(NoHealthyVllmServerError);
    pool.dispose();
  });

  it('marks a server unhealthy after a connection error on a live request', async () => {
    const pool = new MultiServerChatPool([{ host: 'http://a', maxParallel: 1, apiKey: '' }], {
      healthIntervalMs: 0,
      probe: async () => true,
    });

    const boom = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    await expect(
      pool.run(async () => {
        throw boom;
      }),
    ).rejects.toThrow(/ECONNREFUSED/);

    expect(pool.slots[0]!.healthy).toBe(false);
    await expect(pool.run(async () => 'x')).rejects.toBeInstanceOf(NoHealthyVllmServerError);
    pool.dispose();
  });
});

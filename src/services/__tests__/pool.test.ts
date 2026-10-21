import { describe, expect, it } from '@jest/globals';
import { normalizeServiceEndpoints } from '../kinds';
import { NoHealthyServiceError, ServicePool, isServiceConnectionError } from '../pool';

const endpoints = normalizeServiceEndpoints([
  { kind: 'asr', host: 'http://a', maxParallel: 2 },
  { kind: 'asr', host: 'http://b', maxParallel: 2 },
]);

const makePool = (health: Map<string, boolean>) =>
  new ServicePool<string>({
    kind: 'asr',
    endpoints,
    createClient: (e) => e.host,
    probe: async (e) =>
      health.get(e.host) ? { ok: true } : { ok: false, error: `down ${e.host}` },
    healthIntervalMs: 0,
  });

describe('ServicePool', () => {
  it('skips unhealthy hosts until the probe recovers them', async () => {
    const health = new Map([
      ['http://a', false],
      ['http://b', true],
    ]);
    const pool = makePool(health);
    await pool.runHealthChecks();
    const hosts = await Promise.all(
      Array.from({ length: 4 }, () => pool.run(async (client) => client)),
    );
    expect(new Set(hosts)).toEqual(new Set(['http://b']));
    expect(pool.stats.healthyMax).toBe(2);

    health.set('http://a', true);
    await pool.runHealthChecks();
    const again = await Promise.all(
      Array.from({ length: 4 }, () => pool.run(async (client) => client)),
    );
    expect(new Set(again)).toEqual(new Set(['http://a', 'http://b']));
    pool.dispose();
  });

  it('reports no healthy endpoint when every probe fails, and when none is configured', async () => {
    const pool = makePool(new Map());
    const verdict = await pool.probeHealth();
    expect(verdict.ok).toBe(false);
    await expect(pool.run(async () => 1)).rejects.toBeInstanceOf(NoHealthyServiceError);
    pool.dispose();

    const empty = new ServicePool<string>({
      kind: 'tools',
      endpoints: [],
      createClient: (e) => e.host,
      probe: async () => ({ ok: true }),
      healthIntervalMs: 0,
    });
    expect((await empty.probeHealth()).ok).toBe(false);
    await expect(empty.run(async () => 1)).rejects.toThrow('No bethesda-tools endpoints');
  });

  it('marks a host unhealthy on a connection error, not on an application error', async () => {
    const pool = makePool(
      new Map([
        ['http://a', true],
        ['http://b', true],
      ]),
    );
    await pool.runHealthChecks();
    await expect(
      pool.run(async (_client, meta) => {
        if (meta.host === 'http://a')
          throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
        return meta.host;
      }),
    ).rejects.toThrow('refused');
    const aSlot = pool.stats.servers.find((s) => s.host === 'http://a')!;
    expect(aSlot.healthy).toBe(false);
    await expect(
      pool.run(async () => {
        throw Object.assign(new Error('bad request'), { status: 400 });
      }),
    ).rejects.toThrow('bad request');
    expect(pool.stats.servers.find((s) => s.host === 'http://b')!.healthy).toBe(true);
    pool.dispose();
  });

  it('classifies transport failures', () => {
    expect(isServiceConnectionError({ code: 'ECONNREFUSED' })).toBe(true);
    expect(isServiceConnectionError(new Error('fetch failed'))).toBe(true);
    expect(isServiceConnectionError({ status: 503 })).toBe(true);
    expect(isServiceConnectionError({ status: 404, message: 'not found' })).toBe(false);
  });
});

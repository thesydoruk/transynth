import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { FastifyInstance } from 'fastify';

// Nothing listens on port 1: every connect attempt is refused, as in the
// 2026-10-05 outage where the API ran against a database but no Redis.
process.env.REDIS_URL = 'redis://127.0.0.1:1';

const { default: Fastify } = await import('fastify');
const { modAiJobsRoutes } = await import('../modAiJobs');
const { closeSharedRedis } = await import('../../../../worker/src/core/connection');

describe('GET /api/ai-jobs/active without Redis', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await modAiJobsRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeSharedRedis();
  });

  const timedGet = async () => {
    const startedAt = Date.now();
    const res = await app.inject({ method: 'GET', url: '/api/ai-jobs/active' });
    return { res, ms: Date.now() - startedAt };
  };

  it('answers 503 promptly instead of hanging', async () => {
    const { res, ms } = await timedGet();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: expect.stringMatching(/^Job queue unavailable/) });
    expect(ms).toBeLessThan(3_500);
  });

  it('fails at once while the outage is known', async () => {
    const { res, ms } = await timedGet();
    expect(res.statusCode).toBe(503);
    expect(ms).toBeLessThan(200);
  });
});

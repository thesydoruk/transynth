import { describe, expect, it, jest } from '@jest/globals';

// Starting a run enqueues a BullMQ job; a bad run id must never get that far.
const startBackgroundJob = jest.fn(async () => 1);
jest.unstable_mockModule('../../../../worker/src/api/startBackgroundJob', () => ({
  startBackgroundJob,
}));

const { vortexSyncRoutes } = await import('../vortexSync');
const { useTestDb } = await import('../../../testing/testDb');
const { useTestApp } = await import('../../../testing/testApp');

describe('vortex API ids', () => {
  const db = useTestDb();
  const app = useTestApp(db, vortexSyncRoutes);

  it.each([
    ['GET', '/api/vortex/groups/abc', 'Invalid group id'],
    ['GET', '/api/vortex/groups/abc/mods', 'Invalid group id'],
    ['GET', '/api/vortex/groups/abc/latest-run', 'Invalid group id'],
    ['PUT', '/api/vortex/sync/abc/packs/unit-1', 'Invalid run id'],
    ['POST', '/api/vortex/sync/abc/start', 'Invalid run id'],
    ['GET', '/api/vortex/sync/abc', 'Invalid run id'],
    ['GET', '/api/vortex/sync/abc/langpack', 'Invalid run id'],
  ] as const)('answers 400 to %s %s', async (method, url, error) => {
    const res = await app().inject({ method, url });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error });
    expect(startBackgroundJob).not.toHaveBeenCalled();
  });

  it('answers 404 to a well-formed id that does not exist', async () => {
    const get = (url: string) => app().inject({ method: 'GET', url });

    expect((await get('/api/vortex/groups/999')).statusCode).toBe(404);
    expect((await get('/api/vortex/sync/999')).statusCode).toBe(404);
  });
});

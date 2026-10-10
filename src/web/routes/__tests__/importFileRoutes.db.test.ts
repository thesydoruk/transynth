import { describe, expect, it, jest } from '@jest/globals';

// The handlers ask BullMQ whether a job is running; nothing is queued here, and
// a bad id must never get that far.
const pauseQueuedImport = jest.fn(async () => false);
const cancelQueuedImport = jest.fn(async () => false);
jest.unstable_mockModule('../../../../worker/src/api/importJobs', () => ({
  isImportQueued: async () => false,
  listQueuedImportIds: async () => new Set<number>(),
  cancelQueuedImport,
  pauseQueuedImport,
}));

const { csvRoutes } = await import('../csv');
const { eetRoutes } = await import('../eet');
const { useTestDb } = await import('../../../testing/testDb');
const { useTestApp } = await import('../../../testing/testApp');

describe.each(['csv', 'eet'])('/api/%s/:id', (kind) => {
  const db = useTestDb();
  const app = useTestApp(db, csvRoutes, eetRoutes);

  const request = (method: 'GET' | 'PATCH' | 'POST' | 'DELETE', path: string) =>
    app().inject({
      method,
      url: `/api/${kind}/${path}`,
      payload: method === 'PATCH' ? {} : undefined,
    });

  it.each([
    ['GET', 'abc/preview'],
    ['PATCH', 'abc'],
    ['GET', 'abc/import'],
    ['POST', 'abc/pause'],
    ['POST', 'abc/cancel'],
    ['DELETE', 'abc'],
  ] as const)('answers 400 to %s %s', async (method, path) => {
    const res = await request(method, path);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid import job id' });
    expect(pauseQueuedImport).not.toHaveBeenCalled();
    expect(cancelQueuedImport).not.toHaveBeenCalled();
  });

  it('answers 400 to an id that is not a positive integer, 404 to a missing job', async () => {
    expect((await request('DELETE', '0')).statusCode).toBe(400);
    expect((await request('DELETE', '1.5')).statusCode).toBe(400);
    expect((await request('DELETE', '999')).statusCode).toBe(404);
  });
});

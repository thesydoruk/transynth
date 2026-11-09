import { afterAll, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Starting a run enqueues a BullMQ job; a bad run id must never get that far.
const startBackgroundJob = jest.fn(async () => 1);
jest.unstable_mockModule('../../../../worker/src/api/startBackgroundJob', () => ({
  startBackgroundJob,
}));

const { vortexSyncRoutes } = await import('../vortexSync');
const { useTestDb } = await import('../../../testing/testDb');
const { useTestApp } = await import('../../../testing/testApp');
const { PATHS } = await import('../../../paths');
const { getOrCreateVortexGroup, insertVortexSyncRun, updateVortexSyncRun } =
  await import('../../../vortex/db');
const { finalizeExportArchive, insertExportArchive } = await import('../../data/queries');

const exportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-langpack-'));
PATHS.exports = exportsDir;

describe('vortex API ids', () => {
  const db = useTestDb();
  const app = useTestApp(db, vortexSyncRoutes);
  afterAll(() => fs.rmSync(exportsDir, { recursive: true, force: true }));

  it.each([
    ['GET', '/api/vortex/groups/abc', 'Invalid group id'],
    ['GET', '/api/vortex/groups/abc/mods', 'Invalid group id'],
    ['GET', '/api/vortex/groups/abc/latest-run', 'Invalid group id'],
    ['PUT', '/api/vortex/sync/abc/packs/unit-1', 'Invalid run id'],
    ['POST', '/api/vortex/sync/abc/start', 'Invalid run id'],
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
    expect((await get('/api/vortex/sync/999/langpack')).statusCode).toBe(404);
  });

  // The Vortex page links to this URL; the browser's download manager needs the size.
  it('streams the finished langpack of a run with its size', async () => {
    const group = await getOrCreateVortexGroup(db(), {
      game: 'fo4',
      groupKey: 'gaming-pc',
      label: 'Gaming PC',
      stagingPath: 'C:/Vortex/fallout4/mods',
      gameDir: 'C:/Games/Fallout 4',
    });
    const run = await insertVortexSyncRun(db(), {
      groupId: group.id,
      game: 'fo4',
      srcLang: 'en',
      tgtLang: 'uk',
      channel: 'all',
      plan: { units: [] },
      stage: 'export',
      startedBy: 'ui',
    });
    const archive = await insertExportArchive(db(), {
      game: 'fo4',
      srcLang: 'en',
      tgtLang: 'uk',
      label: `vortex-${group.id}`,
      fileName: 'fo4_uk_langpack.zip',
      modIds: [],
      totalCount: 0,
    });
    const url = `/api/vortex/sync/${run.id}/langpack`;

    expect((await app().inject({ method: 'GET', url })).statusCode).toBe(404);

    fs.mkdirSync(path.join(exportsDir, String(archive.id)));
    fs.writeFileSync(
      path.join(exportsDir, String(archive.id), 'fo4_uk_langpack.zip'),
      'PK-langpack',
    );
    await finalizeExportArchive(db(), archive.id, {
      status: 'completed',
      relPath: `${archive.id}/fo4_uk_langpack.zip`,
      byteSize: 11,
    });
    await updateVortexSyncRun(db(), run.id, { status: 'completed', export_archive_id: archive.id });

    const res = await app().inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-length']).toBe('11');
    expect(res.headers['content-disposition']).toBe('attachment; filename="fo4_uk_langpack.zip"');
    expect(res.body).toBe('PK-langpack');
  });
});

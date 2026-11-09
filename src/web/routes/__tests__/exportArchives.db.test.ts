import { afterAll, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The routes reach BullMQ to start and stop export jobs; none of that runs here.
jest.unstable_mockModule('../../../../worker/src/core/queue', () => ({
  requestJobStop: jest.fn(async () => true),
}));
jest.unstable_mockModule('../../../../worker/src/api/startBackgroundJob', () => ({
  startBackgroundJob: jest.fn(async () => 1),
}));

const { exportArchivesRoutes } = await import('../exportArchives');
const { PATHS } = await import('../../../paths');
const { finalizeExportArchive, insertExportArchive } = await import('../../data/queries');
const { useTestDb } = await import('../../../testing/testDb');
const { useTestApp } = await import('../../../testing/testApp');

const exportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-archives-'));
PATHS.exports = exportsDir;

describe('export archive download', () => {
  const db = useTestDb();
  const app = useTestApp(db, exportArchivesRoutes);
  afterAll(() => fs.rmSync(exportsDir, { recursive: true, force: true }));

  const newArchive = () =>
    insertExportArchive(db(), {
      game: 'fo4',
      srcLang: 'en',
      tgtLang: 'uk',
      label: 'MyMod',
      fileName: 'MyMod_uk_langpack.zip',
      modIds: [1],
      totalCount: 1,
    });
  const get = (id: number) => app().inject({ method: 'GET', url: `/api/exports/${id}/file` });

  // The Mods page links to this URL; a link needs the size for the download manager.
  it('streams a finished archive with its size and name', async () => {
    const archive = await newArchive();
    fs.mkdirSync(path.join(exportsDir, String(archive.id)));
    fs.writeFileSync(path.join(exportsDir, String(archive.id), archive.file_name), 'PK-zip');
    await finalizeExportArchive(db(), archive.id, {
      status: 'completed',
      relPath: `${archive.id}/${archive.file_name}`,
      byteSize: 6,
    });

    const res = await get(archive.id);

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-length']).toBe('6');
    expect(res.headers['content-disposition']).toBe('attachment; filename="MyMod_uk_langpack.zip"');
    expect(res.body).toBe('PK-zip');
  });

  it('refuses an archive that is still being built', async () => {
    const archive = await newArchive();

    const res = await get(archive.id);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'Archive is not ready to download' });
  });

  it('reports a finished archive whose file is gone', async () => {
    const archive = await newArchive();
    await finalizeExportArchive(db(), archive.id, {
      status: 'completed',
      relPath: `${archive.id}/gone.zip`,
      byteSize: 6,
    });

    const res = await get(archive.id);

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Archive file is missing' });
  });
});

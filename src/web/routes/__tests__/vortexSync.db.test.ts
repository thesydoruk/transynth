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

const { default: multipart } = await import('@fastify/multipart');
await import('../../../games');
const { ensureModImportSchema } = await import('../../../import/mod/schema');
const { npcPlugin } = await import('../../../testing/espFixture');
const { packFilesToZipPath } = await import('../../export/zipPack');

const exportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-langpack-'));
PATHS.exports = exportsDir;
const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-uploads-'));
PATHS.vortexUploads = uploadsDir;

/** A multipart body with one `file` field, as the agent's upload sends it. */
const filePart = (fileName: string, content: Buffer) => {
  const boundary = '----transynth-test-boundary';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
        'Content-Type: application/zip\r\n\r\n',
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
};

describe('vortex API ids', () => {
  const db = useTestDb();
  const app = useTestApp(
    db,
    async (instance) => {
      await instance.register(multipart);
    },
    vortexSyncRoutes,
  );
  afterAll(() => {
    fs.rmSync(exportsDir, { recursive: true, force: true });
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  });

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

  it('plans for the machine the agent names', async () => {
    const plan = (agentKey: string) =>
      app().inject({
        method: 'POST',
        url: '/api/vortex/sync/plan',
        payload: {
          groupKey: 'fo4:c:/vortex/fallout4/mods',
          game: 'fo4',
          stagingPath: 'C:/Vortex/fallout4/mods',
          gameDir: `C:/Games/${agentKey}`,
          agentKey,
          units: [],
        },
      });

    const desk = (await plan('desk')).json();
    const laptop = (await plan('laptop')).json();

    expect(laptop.group.id).toBe(desk.group.id);
    const { rows } = await db().query(
      `SELECT a.agent_key, a.game_dir, r.id AS run_id
       FROM vortex_sync_runs r JOIN vortex_agents a ON a.id = r.agent_id ORDER BY r.id`,
    );
    expect(rows).toEqual([
      { agent_key: 'desk', game_dir: 'C:/Games/desk', run_id: desk.run.id },
      { agent_key: 'laptop', game_dir: 'C:/Games/laptop', run_id: laptop.run.id },
    ]);
  });

  // Two machines of a group hold the same folder and sync at the same moment.
  it('registers a folder once when two machines upload it together', async () => {
    await ensureModImportSchema(db());
    const zipPath = path.join(uploadsDir, 'shared.zip');
    await packFilesToZipPath(
      [{ name: 'Shared.esp', data: npcPlugin(['Jake', 'Sheffield']) }],
      zipPath,
    );
    const zip = fs.readFileSync(zipPath);
    const unit = {
      unitId: 'mods:shared-1-0',
      channel: 'mods',
      name: 'Shared',
      pluginStem: 'Shared',
      pluginFileName: 'Shared.esp',
      sourceFolder: 'Shared-1-0',
      nexusModId: null,
      nexusModName: null,
      contentHash: 'dd44',
    };
    const plan = async (agentKey: string) =>
      (
        await app().inject({
          method: 'POST',
          url: '/api/vortex/sync/plan',
          payload: {
            groupKey: 'fo4:c:/vortex/fallout4/mods',
            game: 'fo4',
            stagingPath: 'C:/Vortex/fallout4/mods',
            gameDir: 'C:/Games/Fallout 4',
            agentKey,
            units: [unit],
          },
        })
      ).json();
    const desk = await plan('desk');
    const laptop = await plan('laptop');
    expect(laptop.units[0].action).toBe('upload');
    const upload = (runId: number) =>
      app().inject({
        method: 'PUT',
        url: `/api/vortex/sync/${runId}/packs/${encodeURIComponent(unit.unitId)}`,
        ...filePart('Shared.zip', zip),
      });

    const [first, second] = await Promise.all([upload(desk.run.id), upload(laptop.run.id)]);

    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(second.json().job.id).toBe(first.json().job.id);
    const { rows } = await db().query(`SELECT file_hash FROM mod_imports`);
    expect(rows).toEqual([{ file_hash: `v${desk.group.id}:dd44` }]);
    // Each run knows the job, so each machine's import stage finds it.
    const { rows: units } = await db().query(
      `SELECT (plan_json->'units'->0->>'existingJobId')::int AS job_id FROM vortex_sync_runs ORDER BY id`,
    );
    expect(units).toEqual([{ job_id: first.json().job.id }, { job_id: first.json().job.id }]);
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

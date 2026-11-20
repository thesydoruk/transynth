import { describe, expect, it, jest } from '@jest/globals';

// The state route probes service hosts; none are configured under test, but the
// probe must not reach the network either way.
jest.unstable_mockModule('../../../services/kindHealth', () => ({
  probeKindsHealthy: jest.fn(async () => ({ llm: false, embed: false, tts: true })),
  probeKindHealthy: jest.fn(async () => false),
}));

const { vortexAgentRoutes } = await import('../vortexAgent');
const { useTestDb } = await import('../../../testing/testDb');
const { useTestApp } = await import('../../../testing/testApp');
const { insertVortexSyncRun, updateVortexSyncRun } = await import('../../../vortex/db');
const { finalizeExportArchive, insertExportArchive } = await import('../../data/queries');

const beat = {
  game: 'fo4',
  stagingPath: 'D:/Vortex/fallout4/mods',
  gameDir: 'D:/Games/Fallout4',
  agentKey: 'gaming-pc',
  agentVersion: '0.10.0',
  state: 'idle',
  pollSec: 30,
  pending: null,
  lastSyncAt: null,
  lastRunId: null,
  lastError: null,
  delivered: null,
};

describe('vortex agent API', () => {
  const db = useTestDb();
  const app = useTestApp(db, vortexAgentRoutes);

  const heartbeat = (payload: object) =>
    app().inject({ method: 'POST', url: '/api/vortex/agent/heartbeat', payload });

  it('creates the group on the first heartbeat and reports it back', async () => {
    const res = await heartbeat(beat);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, latestLangpack: null });
    const { rows } = await db().query(
      `SELECT g.label, a.agent_key, a.state FROM vortex_agents a
       JOIN vortex_groups g ON g.id = a.vortex_group_id`,
    );
    expect(rows).toEqual([{ label: 'Vortex · fallout4', agent_key: 'gaming-pc', state: 'idle' }]);
  });

  it('updates the same agent row on later heartbeats', async () => {
    const first = (await heartbeat(beat)).json();
    const second = (await heartbeat({ ...beat, state: 'error', lastError: 'disk full' })).json();

    expect(second.groupId).toBe(first.groupId);
    expect(second.agentId).toBe(first.agentId);
    const { rows } = await db().query(`SELECT state, last_error FROM vortex_agents`);
    expect(rows).toEqual([{ state: 'error', last_error: 'disk full' }]);
  });

  it.each([
    ['an unknown game', { ...beat, game: 'disco' }],
    ['no staging path', { ...beat, stagingPath: '' }],
    ['a made-up state', { ...beat, state: 'sleeping' }],
  ])('rejects a heartbeat with %s', async (_case, payload) => {
    expect((await heartbeat(payload)).statusCode).toBe(400);
  });

  it('stores the export order and shows it in the group state', async () => {
    const { groupId } = (await heartbeat(beat)).json();
    const exportOrder = {
      plugins: ['Fallout4.esm', 'Foo.esp'],
      fileWinners: [{ path: 'Data/Foo.esp', sourceFolder: 'Foo-1-0' }],
    };
    const put = await app().inject({
      method: 'POST',
      url: `/api/vortex/groups/${groupId}/export-order`,
      payload: { exportOrder },
    });
    expect(put.json()).toEqual({ ok: true, plugins: 2, fileWinners: 1 });

    const state = (await app().inject({ url: `/api/vortex/groups/${groupId}/state` })).json();
    expect(state).toMatchObject({
      group: { id: groupId },
      agent: { agent_key: 'gaming-pc' },
      machines: [
        {
          agent_key: 'gaming-pc',
          game_dir: 'D:/Games/Fallout4',
          mod_count: null,
          game_version: null,
          latestLangpack: null,
        },
      ],
      currentRun: null,
      latestLangpack: null,
      services: { llm: false, embed: false, tts: true },
    });
    // An agent older than machines names none: the order goes to the group's only machine.
    const { rows } = await db().query(
      `SELECT a.export_order_json AS machine, g.export_order_json AS grp
       FROM vortex_agents a JOIN vortex_groups g ON g.id = a.vortex_group_id`,
    );
    expect(rows).toEqual([{ machine: exportOrder, grp: null }]);
  });

  it('offers a machine the langpack made for it, not another machine’s', async () => {
    const desk = (await heartbeat(beat)).json();
    const laptop = (await heartbeat({ ...beat, agentKey: 'laptop' })).json();
    const archive = await insertExportArchive(db(), {
      game: 'fo4',
      srcLang: 'en',
      tgtLang: 'uk',
      label: `vortex-${desk.groupId}`,
      fileName: 'fo4_uk_langpack.zip',
      modIds: [],
      totalCount: 0,
    });
    await finalizeExportArchive(db(), archive.id, {
      status: 'completed',
      relPath: `${archive.id}/fo4_uk_langpack.zip`,
      byteSize: 11,
    });
    const run = await insertVortexSyncRun(db(), {
      groupId: desk.groupId,
      game: 'fo4',
      srcLang: 'en',
      tgtLang: 'uk',
      channel: 'all',
      plan: {},
      stage: 'export',
      agentId: desk.agentId,
    });
    await updateVortexSyncRun(db(), run.id, { status: 'completed', export_archive_id: archive.id });

    expect((await heartbeat(beat)).json().latestLangpack).toMatchObject({ archiveId: archive.id });
    expect((await heartbeat({ ...beat, agentKey: 'laptop' })).json().latestLangpack).toBeNull();

    const state = (await app().inject({ url: `/api/vortex/groups/${desk.groupId}/state` })).json();
    const byKey = Object.fromEntries(
      state.machines.map((m: { agent_key: string; latestLangpack: unknown }) => [
        m.agent_key,
        m.latestLangpack,
      ]),
    );
    expect(byKey).toEqual({
      'gaming-pc': {
        archiveId: archive.id,
        runId: run.id,
        fileName: 'fo4_uk_langpack.zip',
        byteSize: 11,
      },
      laptop: null,
    });
    expect(laptop.agentId).not.toBe(desk.agentId);
  });

  it('keeps each machine’s paths and load order on its own row', async () => {
    const { groupId } = (await heartbeat(beat)).json();
    await heartbeat({ ...beat, agentKey: 'laptop', gameDir: 'E:/Fallout4' });
    const order = (plugin: string) => ({ plugins: [plugin], fileWinners: [] });
    const post = (payload: object) =>
      app().inject({ method: 'POST', url: `/api/vortex/groups/${groupId}/export-order`, payload });

    await post({ exportOrder: order('Desk.esp'), agentKey: 'gaming-pc' });
    await post({ exportOrder: order('Laptop.esp'), agentKey: 'laptop' });
    // With two machines an order that names none cannot be told apart: it stays the group's.
    await post({ exportOrder: order('Unnamed.esp') });

    const { rows } = await db().query(
      `SELECT agent_key, game_dir, export_order_json->'plugins' AS plugins
       FROM vortex_agents ORDER BY agent_key`,
    );
    expect(rows).toEqual([
      { agent_key: 'gaming-pc', game_dir: 'D:/Games/Fallout4', plugins: ['Desk.esp'] },
      { agent_key: 'laptop', game_dir: 'E:/Fallout4', plugins: ['Laptop.esp'] },
    ]);
  });

  it('rejects a malformed export order', async () => {
    const { groupId } = (await heartbeat(beat)).json();
    const res = await app().inject({
      method: 'POST',
      url: `/api/vortex/groups/${groupId}/export-order`,
      payload: { exportOrder: { plugins: 'Fallout4.esm' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('answers 400 and 404 for bad group ids', async () => {
    expect((await app().inject({ url: '/api/vortex/groups/abc/state' })).statusCode).toBe(400);
    expect((await app().inject({ url: '/api/vortex/groups/999/runs' })).statusCode).toBe(404);
  });
});

import { describe, expect, it, jest } from '@jest/globals';

const startBackgroundJob = jest.fn<(data: unknown, initial?: unknown) => Promise<number>>(
  async () => 501,
);
jest.unstable_mockModule('../../../../worker/src/api/startBackgroundJob', () => ({
  startBackgroundJob,
}));
const requestJobStop = jest.fn(async () => true);
jest.unstable_mockModule('../../../../worker/src/core/queue', () => ({ requestJobStop }));
jest.unstable_mockModule('../../../../worker/src/api/jobStatus', () => ({
  readJobStatus: jest.fn(async () => null),
}));
const health: Record<string, boolean> = { llm: false, embed: true, tts: true };
jest.unstable_mockModule('../../../services/kindHealth', () => ({
  probeKindsHealthy: jest.fn(async (kinds: readonly string[]) =>
    Object.fromEntries(kinds.map((kind) => [kind, health[kind] ?? false])),
  ),
  probeKindHealthy: jest.fn(async () => false),
}));

const { vortexStagesRoutes } = await import('../vortexStages');
const { vortexAgentRoutes } = await import('../vortexAgent');
const { useTestDb } = await import('../../../testing/testDb');
const { useTestApp } = await import('../../../testing/testApp');

describe('vortex stage API', () => {
  const db = useTestDb();
  const app = useTestApp(db, vortexAgentRoutes, vortexStagesRoutes);

  const makeGroup = async (): Promise<number> => {
    const res = await app().inject({
      method: 'POST',
      url: '/api/vortex/agent/heartbeat',
      payload: {
        game: 'fo4',
        stagingPath: 'D:/Vortex/fallout4/mods',
        gameDir: 'D:/Games/Fallout4',
        agentKey: 'pc',
        state: 'idle',
      },
    });
    return res.json().groupId as number;
  };
  const start = (groupId: number, stage: string, payload: object = {}) =>
    app().inject({ method: 'POST', url: `/api/vortex/groups/${groupId}/stage/${stage}`, payload });

  it('starts a fan-out stage as one vortex-sync job and records the run', async () => {
    const groupId = await makeGroup();

    const res = await start(groupId, 'tm', { startedBy: 'agent' });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ok: true, jobId: 501, stage: 'tm' });
    expect(startBackgroundJob).toHaveBeenCalledWith(
      {
        kind: 'vortex-sync',
        modId: null,
        params: { runId: res.json().runId, stage: 'tm', modIds: [], options: {} },
      },
      { runId: res.json().runId },
    );
    const { rows } = await db().query(
      `SELECT status, stage, started_by, job_id FROM vortex_sync_runs WHERE id = $1`,
      [res.json().runId],
    );
    expect(rows).toEqual([{ status: 'queued', stage: 'tm', started_by: 'agent', job_id: 501 }]);

    const shown = await app().inject({ url: `/api/vortex/sync/${res.json().runId}` });
    expect(shown.json()).toMatchObject({
      stage: 'tm',
      modJobs: [],
      progress: { done: 0, total: 0 },
    });
  });

  it('refuses a second run while one is active', async () => {
    const groupId = await makeGroup();
    await start(groupId, 'tm');

    const res = await start(groupId, 'export');

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/still running/);
  });

  it('refuses a stage whose service kind has no healthy host', async () => {
    const groupId = await makeGroup();

    const res = await start(groupId, 'llm');

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ service: 'llm' });
    expect(startBackgroundJob).not.toHaveBeenCalled();
  });

  it('starts a stage whose hosts are up, and export without any probe', async () => {
    const groupId = await makeGroup();

    expect((await start(groupId, 'voice')).statusCode).toBe(201);
    await db().query(`UPDATE vortex_sync_runs SET status = 'completed'`);
    expect((await start(groupId, 'export')).statusCode).toBe(201);
    expect(startBackgroundJob).toHaveBeenLastCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ from: 'export', to: 'export' }),
      }),
      expect.anything(),
    );
  });

  const beat = (agentKey: string) =>
    app().inject({
      method: 'POST',
      url: '/api/vortex/agent/heartbeat',
      payload: {
        game: 'fo4',
        stagingPath: 'D:/Vortex/fallout4/mods',
        gameDir: 'D:/Games/Fallout4',
        agentKey,
        state: 'idle',
      },
    });
  const runOf = async (runId: number) => {
    const { rows } = await db().query(
      `SELECT agent_id, plan_json->'exportOrder'->'plugins' AS plugins
       FROM vortex_sync_runs WHERE id = $1`,
      [runId],
    );
    return rows[0];
  };

  it('exports for the group’s only machine, with that machine’s load order', async () => {
    const groupId = await makeGroup();
    const { agentId } = (await beat('pc')).json();
    await app().inject({
      method: 'POST',
      url: `/api/vortex/groups/${groupId}/export-order`,
      payload: { exportOrder: { plugins: ['Pc.esp'], fileWinners: [] }, agentKey: 'pc' },
    });

    const res = await start(groupId, 'export');

    expect(res.statusCode).toBe(201);
    expect(await runOf(res.json().runId)).toEqual({ agent_id: agentId, plugins: ['Pc.esp'] });
  });

  it('asks which machine an export is for once the group has two', async () => {
    const groupId = await makeGroup();
    const laptop = (await beat('laptop')).json().agentId as number;

    const unnamed = await start(groupId, 'export');
    expect(unnamed.statusCode).toBe(400);
    expect(unnamed.json().error).toMatch(/name the one/);
    expect((await start(groupId, 'export', { agentId: 999 })).statusCode).toBe(400);
    expect(startBackgroundJob).not.toHaveBeenCalled();

    const named = await start(groupId, 'export', { agentId: laptop });
    expect(named.statusCode).toBe(201);
    expect(await runOf(named.json().runId)).toEqual({ agent_id: laptop, plugins: null });
  });

  it('runs any other stage over the group unless a machine is named', async () => {
    const groupId = await makeGroup();
    const { agentId } = (await beat('pc')).json();

    const whole = await start(groupId, 'tm');
    expect(await runOf(whole.json().runId)).toMatchObject({ agent_id: null });
    await db().query(`UPDATE vortex_sync_runs SET status = 'completed'`);

    const own = await start(groupId, 'tm', { startedBy: 'agent', agentKey: 'pc' });
    expect(await runOf(own.json().runId)).toMatchObject({ agent_id: agentId });
  });

  it('answers 400 for unknown or agent-only stages and bad ids', async () => {
    const groupId = await makeGroup();

    expect((await start(groupId, 'install')).statusCode).toBe(400);
    expect((await start(groupId, 'import')).statusCode).toBe(400);
    expect((await start(groupId, 'plan')).statusCode).toBe(400);
    expect(
      (await app().inject({ method: 'POST', url: '/api/vortex/groups/abc/stage/tm' })).statusCode,
    ).toBe(400);
    expect((await start(999, 'tm')).statusCode).toBe(404);
    expect(
      (await app().inject({ method: 'POST', url: '/api/vortex/sync/abc/stop' })).statusCode,
    ).toBe(400);
    expect((await app().inject({ url: '/api/vortex/sync/999' })).statusCode).toBe(404);
  });

  it('stops the run job and every running per-mod job', async () => {
    const groupId = await makeGroup();
    const { runId } = (await start(groupId, 'tm')).json();
    await db().query(
      `UPDATE vortex_sync_runs SET plan_json = plan_json || $2::jsonb WHERE id = $1`,
      [
        runId,
        JSON.stringify({
          modJobs: [
            {
              modId: 1,
              name: 'A',
              kind: 'tm-apply',
              jobId: 77,
              status: 'running',
              done: 0,
              total: 0,
              error: null,
            },
          ],
        }),
      ],
    );

    const res = await app().inject({ method: 'POST', url: `/api/vortex/sync/${runId}/stop` });

    expect(res.json()).toEqual({ ok: true, stopped: [77, 501] });
  });
});

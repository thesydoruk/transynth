import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import '../../../games';
import type { AgentApi } from '../apiClient';
import { parseAgentConfig } from '../config';
import { AgentControl } from '../control';
import { VortexAgentLoop, defaultAgentPaths } from '../loop';
import { emptyAgentState, readAgentState, writeAgentState, type AgentState } from '../state';
import { buildAgentStatus } from '../status';

const LANGPACK = { archiveId: 22, runId: 9, fileName: 'pack.zip', byteSize: 3 };

describe('the agent loop under the page’s commands', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-loop-'));
    const modDir = path.join(root, 'staging', 'Cool Mod-1-1');
    fs.mkdirSync(modDir, { recursive: true });
    fs.writeFileSync(path.join(modDir, 'CoolMod.esp'), 'plugin');
    fs.mkdirSync(path.join(root, 'game', 'Data'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const setup = (saved: Partial<AgentState> = {}) => {
    const config = parseAgentConfig(
      {
        api: 'http://localhost:1',
        token: 'secret-token',
        game: 'fo4',
        stagingPath: path.join(root, 'staging'),
        gameDir: path.join(root, 'game'),
        downloadsDir: path.join(root, 'downloads'),
        channel: 'mods',
        autoStages: 'carry',
        settleSec: 0,
      },
      {},
    );
    const paths = defaultAgentPaths(path.join(root, 'data'));
    writeAgentState(paths.state, { ...emptyAgentState(), ...saved });
    const plan = jest.fn(async (_url: string, body: unknown) => ({
      run: { id: 7 },
      group: { id: 1 },
      units: (body as { units: Array<{ unitId: string }> }).units.map((u) => ({
        unitId: u.unitId,
        action: 'skip',
      })),
    }));
    const downloadLangpack = jest.fn(async (_runId: number, dest: string) => {
      fs.writeFileSync(dest, 'zip');
      return 3;
    });
    const api = {
      heartbeat: jest.fn(async () => ({ ok: true, groupId: 1, latestLangpack: LANGPACK })),
      post: plan,
      postExportOrder: jest.fn(async () => ({ ok: true })),
      startRange: jest.fn(async () => ({ ok: true, skipped: false })),
      waitRun: jest.fn(async () => ({ status: 'completed' })),
      downloadLangpack,
    } as unknown as AgentApi;
    const control = new AgentControl();
    const loop = new VortexAgentLoop({ config, api, paths, agentVersion: '1.2.3', control });
    const status = () =>
      buildAgentStatus({
        config,
        configPath: path.join(root, 'vortex-agent.json'),
        journalPath: paths.journal,
        agentVersion: '1.2.3',
        control,
        view: () => loop.view(),
      });
    return { loop, control, plan, downloadLangpack, paths, status };
  };

  it('syncs a changed staging folder once it has settled', async () => {
    const { loop, plan, status } = setup({ deliveredArchiveId: 22 });
    await loop.tick();
    expect(plan).not.toHaveBeenCalled();
    expect(status().state).toBe('settling');
    await loop.tick();
    expect(plan).toHaveBeenCalledTimes(1);
    expect(status()).toMatchObject({
      state: 'idle',
      lastRunId: 7,
      scan: { units: 1 },
      server: { ok: true, pageUrl: 'http://localhost:1/games/fo4/vortex' },
    });
  });

  it('does nothing on its own while paused, and still syncs when told to', async () => {
    const { loop, control, plan, downloadLangpack, status } = setup();
    control.command('pause');
    await loop.tick();
    await loop.tick();
    await loop.tick();
    expect(plan).not.toHaveBeenCalled();
    expect(downloadLangpack).not.toHaveBeenCalled();
    expect(status()).toMatchObject({ state: 'paused', paused: true, syncRequested: false });

    control.command('sync');
    expect(status().syncRequested).toBe(true);
    await loop.tick();
    expect(plan).toHaveBeenCalledTimes(1);
    expect(downloadLangpack).not.toHaveBeenCalled();

    control.command('resume');
    await loop.tick();
    expect(downloadLangpack).toHaveBeenCalledTimes(1);
  });

  it('a sync request cuts a retry backoff short and runs the stages again', async () => {
    const retryAfter = new Date(Date.now() + 20 * 60_000).toISOString();
    const { loop, control, plan, paths, status } = setup({
      deliveredArchiveId: 22,
      lastRunId: 5,
      failures: 3,
      lastError: 'boom',
      retryAfter,
    });
    await loop.tick();
    await loop.tick();
    expect(plan).not.toHaveBeenCalled();
    expect(status()).toMatchObject({ retryAfter, failures: 3, lastError: 'boom' });

    control.command('sync');
    await loop.tick();
    expect(plan).toHaveBeenCalledTimes(1);
    expect(readAgentState(paths.state)).toMatchObject({
      retryAfter: null,
      failures: 0,
      lastError: null,
      resyncNeeded: false,
    });
    expect(status().journal.map((e) => e.event)).toEqual(['command', 'sync']);
  });

  it('delivers the same langpack again on request', async () => {
    const { loop, control, downloadLangpack, paths } = setup({ deliveredArchiveId: 22 });
    await loop.tick();
    expect(downloadLangpack).not.toHaveBeenCalled();
    control.command('redeliver');
    await loop.tick();
    expect(downloadLangpack).toHaveBeenCalledTimes(1);
    expect(readAgentState(paths.state).deliveredArchiveId).toBe(22);
  });

  it('never puts the CLI token into the status', () => {
    const { status } = setup();
    expect(JSON.stringify(status())).not.toContain('secret-token');
  });

  it('a command ends the wait between ticks, and stop ends the loop', async () => {
    const { loop, control } = setup({ deliveredArchiveId: 22 });
    const started = Date.now();
    const running = loop.run();
    setTimeout(() => control.command('stop'), 50);
    await running;
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

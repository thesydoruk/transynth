import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { AgentApi } from '../apiClient';
import { parseAgentConfig } from '../config';
import { runSyncCycle } from '../syncCycle';
import { emptyAgentState, type AgentState } from '../state';

/**
 * By default a server that already holds every unit: the plan needs no upload.
 * With `uploadError` it asks for every unit and the upload fails that way.
 */
const makeApi = (opts: { uploadError?: string } = {}) => {
  const calls: string[] = [];
  const api = {
    post: jest.fn(async (url: string, body: unknown) => {
      calls.push(`post ${url}`);
      const units = (body as { units: Array<{ unitId: string }> }).units.map((u) => ({
        unitId: u.unitId,
        action: opts.uploadError ? 'upload' : 'skip',
      }));
      return { run: { id: 7 }, group: { id: 1 }, units };
    }),
    postExportOrder: jest.fn(async () => {
      calls.push('export-order');
    }),
    putUnitZip: jest.fn(async () => {
      calls.push('upload');
      if (opts.uploadError) throw new Error(opts.uploadError);
    }),
    startRange: jest.fn(async () => {
      calls.push('start import..carry');
      return { skipped: false };
    }),
    startStage: jest.fn(async () => {
      calls.push('start tm');
      return { runId: 8 };
    }),
    waitRun: jest.fn(async () => undefined),
    get: jest.fn(async () => ({ run: { status: 'completed' } })),
  } as unknown as AgentApi;
  return { api, calls };
};

describe('runSyncCycle after a failed cycle', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sync-'));
    const modDir = path.join(root, 'staging', 'Cool Mod-1-1');
    fs.mkdirSync(modDir, { recursive: true });
    fs.writeFileSync(path.join(modDir, 'CoolMod.esp'), 'plugin');
    fs.mkdirSync(path.join(root, 'game', 'Data'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const run = async (state: AgentState, opts: { uploadError?: string } = {}) => {
    const config = parseAgentConfig({
      api: 'http://localhost:1',
      game: 'fo4',
      stagingPath: path.join(root, 'staging'),
      gameDir: path.join(root, 'game'),
      downloadsDir: path.join(root, 'downloads'),
      channel: 'mods',
      autoStages: 'carry',
    });
    const { api, calls } = makeApi(opts);
    const outcome = await runSyncCycle({ config, state, cache: {}, api });
    return { outcome, calls, state };
  };

  it('fails the cycle and keeps the old signature when an upload went unregistered', async () => {
    const state = { ...emptyAgentState(), lastRunId: 5, groupId: 1 };
    const before = state.signatures.units;

    await expect(
      run(state, {
        uploadError:
          'Upload mods:cool mod-1-1:coolmod was not registered by the server (200: <!doctype html>)',
      }),
    ).rejects.toThrow('was not registered');
    expect(state.signatures.units).toBe(before);
  });

  it('skips a unit the server refused and carries on', async () => {
    const state = { ...emptyAgentState(), lastRunId: 5, groupId: 1 };
    const { outcome } = await run(state, {
      uploadError:
        'Upload mods:cool mod-1-1:coolmod failed: 500 {"message":"Archive holds no files"}',
    });
    expect(outcome.kind).toBe('order-only');
  });

  it('runs the stages for an inventory the server already holds when the last cycle failed', async () => {
    const state = { ...emptyAgentState(), lastRunId: 5, groupId: 1, resyncNeeded: true };
    const { outcome, calls } = await run(state);
    expect(outcome.kind).toBe('synced');
    expect(calls).toEqual(['post /api/vortex/sync/plan', 'export-order', 'start import..carry']);
    expect(state.resyncNeeded).toBe(false);
  });

  it('otherwise treats a known inventory with nothing to upload as order-only', async () => {
    const state = { ...emptyAgentState(), lastRunId: 5, groupId: 1 };
    const { outcome, calls } = await run(state);
    expect(outcome.kind).toBe('order-only');
    expect(calls).toEqual(['post /api/vortex/sync/plan', 'export-order']);
  });
});

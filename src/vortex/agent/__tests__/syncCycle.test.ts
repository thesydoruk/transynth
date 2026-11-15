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
 * With `uploadError` it asks for every unit and the upload fails that way; with
 * `imported` it asks for every unit, takes it, and names those mods as imported
 * (`null`: an older server that names none).
 */
type ApiOpts = { uploadError?: string; imported?: number[] | null };

const makeApi = (opts: ApiOpts = {}) => {
  const calls: string[] = [];
  const wantsUpload = opts.uploadError != null || opts.imported !== undefined;
  const api = {
    post: jest.fn(async (url: string, body: unknown) => {
      calls.push(`post ${url}`);
      const units = (body as { units: Array<{ unitId: string }> }).units.map((u) => ({
        unitId: u.unitId,
        action: wantsUpload ? 'upload' : 'skip',
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
    startRange: jest.fn(async (_run: number, _from: string, _to: string, extra: object) => {
      calls.push(`start import..carry${'allMods' in extra ? ' (all mods)' : ''}`);
      return { skipped: false };
    }),
    startStage: jest.fn(async (_group: number, _stage: string, body: { modIds?: number[] }) => {
      calls.push(`start tm ${body.modIds ? body.modIds.join(',') : 'all'}`);
      return { runId: 8 };
    }),
    waitRun: jest.fn(async () => ({
      plan_json: opts.imported ? { importedModIds: opts.imported } : {},
    })),
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

  const run = async (
    state: AgentState,
    opts: ApiOpts = {},
    autoStages: 'carry' | 'tm' = 'carry',
  ) => {
    const config = parseAgentConfig({
      api: 'http://localhost:1',
      game: 'fo4',
      stagingPath: path.join(root, 'staging'),
      gameDir: path.join(root, 'game'),
      downloadsDir: path.join(root, 'downloads'),
      channel: 'mods',
      autoStages,
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
    expect(outcome).toMatchObject({ kind: 'order-only', rejected: ['Cool Mod'] });
  });

  it('runs the stages for an inventory the server already holds when the last cycle failed', async () => {
    const state = { ...emptyAgentState(), lastRunId: 5, groupId: 1, resyncNeeded: true };
    const { outcome, calls } = await run(state);
    expect(outcome.kind).toBe('synced');
    expect(calls).toEqual([
      'post /api/vortex/sync/plan',
      'export-order',
      'start import..carry (all mods)',
    ]);
    expect(state.resyncNeeded).toBe(false);
  });

  it('carries and runs TM for the new mod only', async () => {
    const state = { ...emptyAgentState(), lastRunId: 5, groupId: 1 };
    const { calls } = await run(state, { imported: [254] }, 'tm');
    expect(calls.slice(-2)).toEqual(['start import..carry', 'start tm 254']);
  });

  it('goes over the whole group after a failed cycle', async () => {
    const state = { ...emptyAgentState(), lastRunId: 5, groupId: 1, resyncNeeded: true };
    const { calls } = await run(state, { imported: [254] }, 'tm');
    expect(calls.slice(-2)).toEqual(['start import..carry (all mods)', 'start tm all']);
  });

  it('starts no TM when the run imported nothing', async () => {
    const state = { ...emptyAgentState(), lastRunId: 5, groupId: 1 };
    const { calls, outcome } = await run(state, { imported: [] }, 'tm');
    expect(calls.at(-1)).toBe('start import..carry');
    expect(outcome).toMatchObject({ kind: 'synced', tmRunId: null });
  });

  it('runs TM over the group when an older server names no imported mods', async () => {
    const state = { ...emptyAgentState(), lastRunId: 5, groupId: 1 };
    const { calls } = await run(state, { imported: null }, 'tm');
    expect(calls.at(-1)).toBe('start tm all');
  });

  it('otherwise treats a known inventory with nothing to upload as order-only', async () => {
    const state = { ...emptyAgentState(), lastRunId: 5, groupId: 1 };
    const { outcome, calls } = await run(state);
    expect(outcome.kind).toBe('order-only');
    expect(calls).toEqual(['post /api/vortex/sync/plan', 'export-order']);
  });
});

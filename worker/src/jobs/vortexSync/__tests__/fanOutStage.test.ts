import { describe, expect, it, jest } from '@jest/globals';

const updateVortexSyncRun = jest.fn<(db: unknown, id: number, patch: unknown) => Promise<void>>(
  async () => undefined,
);
jest.unstable_mockModule('../../../../../src/vortex/db', () => ({ updateVortexSyncRun }));
jest.unstable_mockModule('../../../../../src/logger', () => ({
  log: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

import type { JobSnapshot } from '../../../types';

const { jobDataForStage, runFanOutStage } = await import('../fanOutStage');

const run = {
  id: 7,
  vortex_group_id: 1,
  game: 'fo4',
  src_lang: 'en',
  tgt_lang: 'uk',
  channel: 'all',
  status: 'running',
  current_stage: null,
  last_completed_stage: null,
  current_mod_id: null,
  job_id: 99,
  export_archive_id: null,
  error: null,
  plan_json: { modIds: [] },
};
const mods = [
  { id: 11, name: 'Alpha', game: 'fo4' },
  { id: 12, name: 'Beta', game: 'fo4' },
];

describe('jobDataForStage', () => {
  it('builds the same payloads the per-mod routes do, with their defaults', () => {
    expect(jobDataForStage('tm', mods[0]!, run)).toEqual({
      data: { kind: 'tm-apply', modId: 11, params: { srcLang: 'en', targetLang: 'uk' } },
      initial: { applied: 0, skipped: 0 },
    });
    expect(jobDataForStage('skip', mods[0]!, run).data.params).toMatchObject({
      useLlm: false,
      persist: true,
      force: false,
    });
    expect(jobDataForStage('gender', mods[0]!, run).data.params).toMatchObject({ useLlm: true });
    expect(
      jobDataForStage('verify', mods[0]!, run, { fixSuspicious: true }).data.params,
    ).toMatchObject({ autoApproveVerified: false, fixSuspicious: true, dryRun: false });
    expect(
      jobDataForStage('voice', mods[0]!, run, { scope: 'low-similarity' }).data.params,
    ).toMatchObject({ scope: 'low-similarity', modName: 'Alpha', game: 'fo4' });
  });
});

describe('runFanOutStage', () => {
  const snapshot = (jobId: number, status: JobSnapshot['status'], done = 0): JobSnapshot => ({
    jobId,
    kind: 'tm-apply',
    modId: null,
    status,
    done,
    total: 10,
    error: status === 'failed' ? 'boom' : null,
    data: {},
  });

  it('enqueues one job at a time and records each outcome', async () => {
    const enqueued: number[] = [];
    let nextId = 100;
    const polls = new Map<number, number>();
    const deps = {
      enqueue: jest.fn(async () => {
        const id = nextId++;
        enqueued.push(id);
        return id;
      }),
      readSnapshot: jest.fn(async (jobId: number) => {
        const n = (polls.get(jobId) ?? 0) + 1;
        polls.set(jobId, n);
        if (n < 2) return snapshot(jobId, 'running', 5);
        return snapshot(jobId, jobId === 101 ? 'failed' : 'completed', 10);
      }),
      isBusy: jest.fn(async () => false),
      stop: jest.fn(async () => true),
      sleep: async () => undefined,
      pollMs: 0,
    };

    const jobs = await runFanOutStage(
      null as never,
      run as never,
      'tm',
      mods,
      {},
      { isCancelled: () => false },
      deps,
    );

    expect(enqueued).toEqual([100, 101]);
    expect(jobs.map((j) => [j.modId, j.jobId, j.status, j.error])).toEqual([
      [11, 100, 'completed', null],
      [12, 101, 'failed', 'boom'],
    ]);
    // The second job was only enqueued after the first one finished.
    expect(deps.enqueue.mock.invocationCallOrder[1]).toBeGreaterThan(
      deps.readSnapshot.mock.invocationCallOrder[1]!,
    );
    expect(updateVortexSyncRun).toHaveBeenCalledWith(
      null,
      7,
      expect.objectContaining({ plan_json: expect.objectContaining({ modJobs: jobs }) }),
    );
  });

  it('skips a mod whose job of that kind already runs, and stops on cancel', async () => {
    let cancelled = false;
    const deps = {
      enqueue: jest.fn(async () => 200),
      readSnapshot: jest.fn(async (jobId: number) => {
        cancelled = true;
        return snapshot(jobId, 'running', 1);
      }),
      isBusy: jest.fn(async (_kinds: readonly string[], modId: number) => modId === 11),
      stop: jest.fn<(jobId: number) => Promise<boolean>>(async () => true),
      sleep: async () => undefined,
      pollMs: 0,
    };

    const jobs = await runFanOutStage(
      null as never,
      run as never,
      'llm',
      mods,
      {},
      { isCancelled: () => cancelled },
      deps,
    );

    expect(jobs[0]).toMatchObject({ modId: 11, status: 'skipped', jobId: null });
    expect(jobs[1]).toMatchObject({ modId: 12, status: 'cancelled', jobId: 200 });
    expect(deps.stop).toHaveBeenCalledWith(200);
    expect(deps.isBusy).toHaveBeenCalledWith(['tm-apply', 'llm-translate'], 11);
  });
});

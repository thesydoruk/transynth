import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveModAiJob } from '../../api';

/*
 * The store and the poll keep module-level state (jobs, clear timers), so
 * every test loads fresh copies of both, with the API under them replaced.
 */
type Snapshot = { status: 'running' | 'completed' | 'cancelled' | 'failed' };

const load = async () => {
  vi.resetModules();
  const { api } = await import('../../api');
  const store = await import('../../modAiJobsStore');
  const { useModAiJobsPoll } = await import('../useModAiJobsPoll');
  const active: { jobs: ActiveModAiJob[] } = { jobs: [] };
  const statuses = new Map<number, Snapshot['status']>();
  const status = async (jobId: number) => ({ status: statuses.get(jobId) ?? 'running' });

  const listActive = vi
    .spyOn(api.modAiJobs, 'listActive')
    .mockImplementation(async () => [...active.jobs]);
  const llmStatus = vi.spyOn(api.llmTranslate, 'status').mockImplementation(status as never);
  const tmStatus = vi.spyOn(api.tmApply, 'status').mockImplementation(status as never);
  vi.spyOn(api.llmVerify, 'status').mockImplementation(status as never);

  const poll = () => renderHook(() => useModAiJobsPoll(true, 1000));
  /** Let one poll round, with its awaited requests, finish. */
  const tick = async (ms = 1000) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  return { store, active, statuses, listActive, llmStatus, tmStatus, poll, tick };
};

const job = (patch: Partial<ActiveModAiJob> = {}): ActiveModAiJob => ({
  jobId: 10,
  modId: 7,
  kind: 'translate',
  done: 3,
  total: 40,
  status: 'running',
  translateMode: 'llm',
  ...patch,
});

// Each test re-imports fresh modules; the first transform of the API graph is
// slow under a full parallel run, so pay for it once, outside any test.
beforeAll(async () => {
  await import('../../api');
  await import('../../modAiJobsStore');
  await import('../useModAiJobsPoll');
}, 60_000);

describe('useModAiJobsPoll', { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows a job the server is running, with its progress', async () => {
    const t = await load();
    t.active.jobs = [job({ done: 12 })];

    t.poll();
    await t.tick(0);

    expect(t.store.getModAiJob(7, 'translate')).toMatchObject({
      status: 'running',
      jobId: 10,
      done: 12,
      total: 40,
    });
  });

  it('marks a job completed once it leaves the queue, then clears the badge', async () => {
    const t = await load();
    t.active.jobs = [job()];
    t.poll();
    await t.tick(0);

    t.active.jobs = [];
    t.statuses.set(10, 'completed');
    await t.tick();
    expect(t.store.getModAiJob(7, 'translate').status).toBe('completed');

    await t.tick(20_000);
    expect(t.store.getModAiJob(7, 'translate').status).toBe('idle');
  });

  it('asks the TM endpoint, not the LLM one, about a TM translate job', async () => {
    const t = await load();
    t.active.jobs = [job({ translateMode: 'tm' })];

    t.poll();
    await t.tick(0);

    expect(t.tmStatus).toHaveBeenCalledWith(10);
    expect(t.llmStatus).not.toHaveBeenCalled();
  });

  it('does not turn a job the user is stopping back into "running"', async () => {
    const t = await load();
    t.store.upsertModAiJob(7, 'translate', { status: 'stopping', jobId: 10 });
    t.active.jobs = [job()];

    t.poll();
    await t.tick(0);
    expect(t.store.getModAiJob(7, 'translate').status).toBe('stopping');

    t.active.jobs = [];
    await t.tick();
    expect(t.store.getModAiJob(7, 'translate').status).toBe('cancelled');
  });

  it('keeps the last known state through a network failure', async () => {
    const t = await load();
    t.active.jobs = [job({ done: 5 })];
    t.poll();
    await t.tick(0);

    t.listActive.mockRejectedValue(new Error('Failed to fetch'));
    await t.tick();

    expect(t.store.getModAiJob(7, 'translate')).toMatchObject({ status: 'running', done: 5 });
  });

  // A finished job's badge lingers for 20 s; a new run of the same kind on the
  // same mod (another tab, the worker re-queuing) must show at once.
  it('shows a new job even while the previous one’s "completed" badge lingers', async () => {
    const t = await load();
    t.store.upsertModAiJob(7, 'translate', { status: 'completed', jobId: 10 });
    t.active.jobs = [job({ jobId: 11, done: 1 })];

    t.poll();
    await t.tick(0);

    expect(t.store.getModAiJob(7, 'translate')).toMatchObject({
      status: 'running',
      jobId: 11,
      done: 1,
    });

    // …and when it ends, its own end shows and the badge goes away.
    t.active.jobs = [];
    t.statuses.set(11, 'completed');
    await t.tick();
    expect(t.store.getModAiJob(7, 'translate')).toMatchObject({ status: 'completed', jobId: 11 });
    await t.tick(20_000);
    expect(t.store.getModAiJob(7, 'translate').status).toBe('idle');
  });

  it('stops polling when the page goes away', async () => {
    const t = await load();
    const hook = t.poll();
    await t.tick(0);
    const calls = t.listActive.mock.calls.length;

    hook.unmount();
    await t.tick(5000);

    expect(t.listActive.mock.calls.length).toBe(calls);
  });
});

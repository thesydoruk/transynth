import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { VoiceEffortResult, VoiceEffortStreamEvent } from '../api';

/*
 * The runner, the job store and the result list keep module-level state, so
 * each test loads fresh copies with the start request replaced by a stream the
 * test drives by hand.
 */
type Stream = {
  emit: (event: VoiceEffortStreamEvent) => void;
  finish: (snapshot: unknown) => void;
  fail: (err: Error) => void;
};

const RESULT: VoiceEffortResult = {
  modId: 7,
  takes: 120,
  measured: 80,
  failed: 2,
  speakers: 4,
  speakersWithBaseline: 3,
  shouting: 9,
  loud: 2,
  skipped: false,
};

const load = async () => {
  vi.resetModules();
  const { api } = await import('../api');
  const store = await import('../modAiJobsStore');
  const results = await import('../voiceEffortResults');
  const runner = await import('../modAiVoiceEffortRunner');
  const streams: Stream[] = [];
  vi.spyOn(api.voiceEffortAnalysis, 'start').mockImplementation(
    ((_modId: number, onEvent: (event: VoiceEffortStreamEvent) => void) =>
      new Promise((resolve, reject) => {
        streams.push({ emit: onEvent, finish: resolve, fail: reject });
      })) as never,
  );
  const stop = vi.spyOn(api.voiceEffortAnalysis, 'stop').mockResolvedValue({ ok: true });
  const stopMod = vi.spyOn(api.voiceEffortAnalysis, 'stopMod').mockResolvedValue({ ok: true });
  vi.spyOn(api.modAiJobs, 'listActive').mockResolvedValue([]);

  const job = () => store.getModAiJob(7, 'voice-effort');
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { store, results, runner, streams, stop, stopMod, job, settle };
};

beforeAll(async () => {
  await import('../api');
  await import('../modAiJobsStore');
  await import('../modAiVoiceEffortRunner');
}, 60_000);

describe('modAiVoiceEffortRunner', { timeout: 20_000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the takes measured of all and hands on the result when the job ends', async () => {
    const t = await load();
    void t.runner.startModVoiceEffort(7);
    await t.settle();
    expect(t.job()).toMatchObject({ status: 'running', jobId: null });

    t.streams[0]!.emit({ type: 'started', jobId: 41, total: 120 });
    t.streams[0]!.emit({ type: 'progress', done: 40, total: 120 });
    expect(t.job()).toMatchObject({ status: 'running', jobId: 41, done: 40, total: 120 });

    t.streams[0]!.finish({
      jobId: 41,
      modId: 7,
      status: 'completed',
      done: 120,
      total: 120,
      error: null,
      result: RESULT,
    });
    await t.settle();

    expect(t.job()).toMatchObject({ status: 'completed', done: 120, total: 120 });
    const { result } = renderHook(() => t.results.useNextVoiceEffortResult());
    expect(result.current).toEqual({ jobId: 41, result: RESULT });

    // The poll reporting the same job again does not bring it back once closed.
    act(() => t.results.dismissVoiceEffortResult(41));
    act(() => t.results.reportVoiceEffortResult({ jobId: 41, result: RESULT }));
    expect(result.current).toBeNull();
  });

  it('does not start a second run while one is going', async () => {
    const t = await load();
    void t.runner.startModVoiceEffort(7);
    void t.runner.startModVoiceEffort(7);
    await t.settle();
    expect(t.streams).toHaveLength(1);
  });

  it('stops by job id once known, by mod before that', async () => {
    const t = await load();
    void t.runner.startModVoiceEffort(7);
    await t.settle();

    await t.runner.stopModVoiceEffort(7, null);
    expect(t.stopMod).toHaveBeenCalledWith(7);
    expect(t.job().status).toBe('cancelled');

    t.streams[0]!.fail(new Error('Cancelled by user'));
    await t.settle();
    expect(t.job().status).toBe('cancelled');

    void t.runner.startModVoiceEffort(7);
    await t.settle();
    t.streams[1]!.emit({ type: 'started', jobId: 42, total: 10 });
    await t.runner.stopModVoiceEffort(7, t.job().jobId);
    expect(t.stop).toHaveBeenCalledWith(42);
  });

  it('shows why the analysis could not run', async () => {
    const t = await load();
    void t.runner.startModVoiceEffort(7);
    await t.settle();
    t.streams[0]!.fail(new Error('Voice generation already running (job #12)'));
    await t.settle();
    expect(t.job()).toMatchObject({
      status: 'failed',
      error: 'Voice generation already running (job #12)',
    });
  });
});

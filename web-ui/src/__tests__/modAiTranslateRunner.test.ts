import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/*
 * The runner and the job store keep module-level state, so each test loads
 * fresh copies with the translate endpoints replaced by a stream the test
 * drives by hand.
 */
type TranslateEvent = {
  type: string;
  jobId?: number;
  total?: number;
  done?: number;
  error?: string;
};

/** One controllable start request. */
type Stream = {
  emit: (event: TranslateEvent) => void;
  finish: (snapshot: unknown) => void;
  fail: (err: Error) => void;
  signal: AbortSignal;
};

const load = async () => {
  vi.resetModules();
  const { api } = await import('../api');
  const store = await import('../modAiJobsStore');
  const runner = await import('../modAiTranslateRunner');
  const streams: Stream[] = [];

  const start = (
    _modId: number,
    _src: string,
    _tgt: string,
    onEvent: (e: TranslateEvent) => void,
    signal: AbortSignal,
  ) =>
    new Promise((resolve, reject) => {
      streams.push({ emit: onEvent, finish: resolve, fail: reject, signal });
    });
  const llmStart = vi.spyOn(api.llmTranslate, 'start').mockImplementation(start as never);
  const tmStart = vi.spyOn(api.tmApply, 'start').mockImplementation(start as never);
  const llmStop = vi.spyOn(api.llmTranslate, 'stop').mockResolvedValue({ ok: true });
  const llmStopMod = vi.spyOn(api.llmTranslate, 'stopMod').mockResolvedValue({ ok: true });
  const tmStop = vi.spyOn(api.tmApply, 'stop').mockResolvedValue({ ok: true });

  const job = () => store.getModAiJob(7, 'translate');
  /** Let the runner's awaits settle. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { store, runner, streams, llmStart, tmStart, llmStop, llmStopMod, tmStop, job, settle };
};

// Each test re-imports fresh modules; the first transform of the API graph is
// slow under a full parallel run, so pay for it once, outside any test.
beforeAll(async () => {
  await import('../api');
  await import('../modAiJobsStore');
  await import('../modAiTranslateRunner');
}, 60_000);

describe('modAiTranslateRunner', { timeout: 20_000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the job as running at once, then follows the stream to completion', async () => {
    const t = await load();
    const run = t.runner.startModAiTranslate(7, 'en', 'uk');

    expect(t.job()).toMatchObject({ status: 'running', translateMode: 'llm', jobId: null });

    t.streams[0]!.emit({ type: 'started', jobId: 42, total: 100 });
    expect(t.job()).toMatchObject({ status: 'running', jobId: 42, done: 0, total: 100 });
    t.streams[0]!.emit({ type: 'progress', done: 60, total: 100 });
    expect(t.job().done).toBe(60);
    t.streams[0]!.emit({ type: 'done', done: 100, total: 100 });
    t.streams[0]!.finish(null);
    await run;

    expect(t.job()).toMatchObject({ status: 'completed', done: 100, total: 100, error: null });
  });

  it('shows the server’s error when the job fails', async () => {
    const t = await load();
    const run = t.runner.startModAiTranslate(7, 'en', 'uk');

    t.streams[0]!.emit({ type: 'error', error: 'VLLM_MODEL is required' });
    t.streams[0]!.finish(null);
    await run;

    expect(t.job()).toMatchObject({ status: 'failed', error: 'VLLM_MODEL is required' });
  });

  it('shows a failed start as failed, with the reason', async () => {
    const t = await load();
    const run = t.runner.startModAiTranslate(7, 'en', 'uk');

    t.streams[0]!.fail(new Error('HTTP 502'));
    await run;

    expect(t.job()).toMatchObject({ status: 'failed', error: 'HTTP 502' });
  });

  it('stops a running job by its id and ignores what the old stream still sends', async () => {
    const t = await load();
    void t.runner.startModAiTranslate(7, 'en', 'uk');
    t.streams[0]!.emit({ type: 'started', jobId: 42, total: 100 });

    await t.runner.stopModAiTranslate(7);

    expect(t.llmStop).toHaveBeenCalledWith(42);
    expect(t.streams[0]!.signal.aborted).toBe(true);
    expect(t.job().status).toBe('cancelled');
    t.streams[0]!.emit({ type: 'progress', done: 99, total: 100 });
    expect(t.job().status).toBe('cancelled');
  });

  it('stops by mod when the job id is not known yet', async () => {
    const t = await load();
    void t.runner.startModAiTranslate(7, 'en', 'uk');

    await t.runner.stopModAiTranslate(7);

    expect(t.llmStopMod).toHaveBeenCalledWith(7);
    expect(t.llmStop).not.toHaveBeenCalled();
  });

  it('stops a TM run through the TM endpoint', async () => {
    const t = await load();
    void t.runner.startModAiTranslateTm(7, 'en', 'uk');
    t.streams[0]!.emit({ type: 'started', jobId: 43, total: 10 });

    await t.runner.stopModAiTranslate(7);

    expect(t.tmStop).toHaveBeenCalledWith(43);
    expect(t.llmStop).not.toHaveBeenCalled();
  });

  it('lets a second start replace the first, whose late events and failure are ignored', async () => {
    const t = await load();
    const first = t.runner.startModAiTranslate(7, 'en', 'uk');
    void t.runner.startModAiTranslateTm(7, 'en', 'uk');

    expect(t.streams[0]!.signal.aborted).toBe(true);
    t.streams[1]!.emit({ type: 'started', jobId: 50, total: 10 });
    t.streams[0]!.emit({ type: 'progress', done: 5, total: 100 });
    t.streams[0]!.fail(new Error('aborted'));
    await first;

    expect(t.job()).toMatchObject({ status: 'running', jobId: 50, translateMode: 'tm', total: 10 });
  });

  it('toggles: starts when idle, stops when running', async () => {
    const t = await load();

    t.runner.toggleModAiTranslate(7, 'en', 'uk');
    expect(t.llmStart).toHaveBeenCalledTimes(1);
    t.streams[0]!.emit({ type: 'started', jobId: 42, total: 100 });

    t.runner.toggleModAiTranslate(7, 'en', 'uk');
    await t.settle();
    expect(t.llmStop).toHaveBeenCalledWith(42);
    expect(t.llmStart).toHaveBeenCalledTimes(1);
  });
});

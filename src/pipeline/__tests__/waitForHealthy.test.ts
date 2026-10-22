import { describe, expect, it, jest } from '@jest/globals';

const noWant = async () => {};
import { DependencyUnavailableError } from '../errors';
import { runWithJobRuntime, type JobRuntime } from '../jobRuntime';
import { ensureDependencyHealthy } from '../waitForHealthy';
import type { NewSystemLog } from '../../web/services/systemLog';

const loggedMessage = (writeLog: { mock: { calls: unknown[][] } }, index: number): string =>
  (writeLog.mock.calls[index]![1] as NewSystemLog).message;

const makeRuntime = (overrides: Partial<JobRuntime> = {}): JobRuntime => ({
  db: {} as JobRuntime['db'],
  jobId: 7,
  kind: 'llm-translate',
  modId: 3,
  emit: jest.fn(),
  mergeSnapshot: jest.fn(),
  signal: new AbortController().signal,
  waitTimeoutMs: 30_000,
  healthIntervalMs: 10_000,
  inflightWaits: new Map(),
  ...overrides,
});

describe('ensureDependencyHealthy', () => {
  it('is a no-op outside a job runtime', async () => {
    const probe = jest.fn(async () => ({ ok: true as const }));
    await ensureDependencyHealthy('llm', { want: noWant, probe });
    expect(probe).not.toHaveBeenCalled();
  });

  it('sends the request path through when the first probe succeeds', async () => {
    const probe = jest.fn(async () => ({ ok: true as const }));
    const writeLog = jest.fn(async () => undefined);
    await runWithJobRuntime(makeRuntime(), () =>
      ensureDependencyHealthy('llm', { want: noWant, probe, writeLog }),
    );
    expect(probe).toHaveBeenCalledTimes(1);
    expect(writeLog).not.toHaveBeenCalled();
  });

  it('retries after the interval and logs spent/remaining attempts', async () => {
    let now = 0;
    const probe = jest.fn(
      async (): Promise<{ ok: true } | { ok: false; error: string }> => ({
        ok: true,
      }),
    );
    probe.mockResolvedValueOnce({ ok: false, error: 'down' }).mockResolvedValueOnce({ ok: true });
    const writeLog = jest.fn(async () => undefined);
    const sleeps: number[] = [];
    const runtime = makeRuntime();

    await runWithJobRuntime(runtime, () =>
      ensureDependencyHealthy('llm', {
        want: noWant,
        probe,
        writeLog,
        now: () => now,
        sleep: async (ms) => {
          sleeps.push(ms);
          now += ms;
        },
      }),
    );

    expect(probe).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([10_000]);
    expect(writeLog).toHaveBeenCalledTimes(2);
    expect(loggedMessage(writeLog, 0)).toContain('spent 1');
    expect(loggedMessage(writeLog, 0)).toContain('remaining 3');
    expect(loggedMessage(writeLog, 1)).toContain('healthy again');
  });

  it('fails the job after the wait window with DependencyUnavailableError', async () => {
    let now = 0;
    const probe = jest.fn(async () => ({ ok: false as const, error: 'down' }));
    const writeLog = jest.fn(async () => undefined);
    const runtime = makeRuntime({ waitTimeoutMs: 20_000, healthIntervalMs: 10_000 });

    await expect(
      runWithJobRuntime(runtime, () =>
        ensureDependencyHealthy('tts', {
          want: noWant,
          probe,
          writeLog,
          now: () => now,
          sleep: async (ms) => {
            now += ms;
          },
        }),
      ),
    ).rejects.toBeInstanceOf(DependencyUnavailableError);

    expect(probe.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(loggedMessage(writeLog, writeLog.mock.calls.length - 1)).toContain('still unavailable');
  });

  it('shares one wait across concurrent callers', async () => {
    let resolveProbe: ((value: { ok: true }) => void) | undefined;
    const probe = jest.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveProbe = resolve;
        }),
    );
    const runtime = makeRuntime();

    const pending = runWithJobRuntime(runtime, () =>
      Promise.all([
        ensureDependencyHealthy('llm', { want: noWant, probe, writeLog: async () => undefined }),
        ensureDependencyHealthy('llm', { want: noWant, probe, writeLog: async () => undefined }),
      ]),
    );

    await new Promise((resolve) => setImmediate(resolve));
    expect(probe).toHaveBeenCalledTimes(1);
    resolveProbe?.({ ok: true });
    await pending;
  });
});

describe('ensureDependencyHealthy want signal', () => {
  it('signals the want before every probe while waiting', async () => {
    const probe = jest.fn(
      async (): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true }),
    );
    probe.mockResolvedValueOnce({ ok: false, error: 'down' }).mockResolvedValueOnce({ ok: true });
    const want = jest.fn(async (_service: string) => {});
    await runWithJobRuntime(makeRuntime({ waitTimeoutMs: 10_000, healthIntervalMs: 1 }), () =>
      ensureDependencyHealthy('asr', { probe, want, writeLog: async () => undefined }),
    );
    expect(want).toHaveBeenCalledTimes(2);
    expect(want).toHaveBeenCalledWith('asr');
  });
});

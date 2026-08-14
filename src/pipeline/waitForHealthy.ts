import { isAbortError } from '../llm/retry';
import { writeSystemLog } from '../web/services/systemLog';
import { DependencyUnavailableError, type DependencyService } from './errors';
import { getJobRuntime, type JobRuntime } from './jobRuntime';
import {
  formatDependencyWaitExhausted,
  formatDependencyWaitFailed,
  formatDependencyWaitRecovered,
} from './messages';
import { probeDependencyHealth, type HealthProbeResult } from './probes';

export type WaitForHealthyDeps = {
  probe?: (service: DependencyService) => Promise<HealthProbeResult>;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  writeLog?: typeof writeSystemLog;
};

const sleepWithSignal = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

const remainingAttemptsAfterFail = (
  deadlineMs: number,
  nowMs: number,
  intervalMs: number,
): number => {
  const timeLeft = deadlineMs - nowMs;
  if (timeLeft <= 0) return 0;
  return Math.ceil(timeLeft / intervalMs);
};

const logWait = async (
  runtime: JobRuntime,
  writeLog: typeof writeSystemLog,
  level: 'error' | 'info',
  message: string,
  details: Record<string, unknown>,
): Promise<void> => {
  await writeLog(runtime.db, {
    level,
    source: details.service === 'tts' ? 'tts' : 'llm',
    message,
    jobId: runtime.jobId,
    jobKind: runtime.kind,
    modId: runtime.modId,
    details,
  });
};

const waitUntilHealthy = async (
  service: DependencyService,
  runtime: JobRuntime,
  deps: WaitForHealthyDeps = {},
): Promise<void> => {
  const probe = deps.probe ?? probeDependencyHealth;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? sleepWithSignal;
  const writeLog = deps.writeLog ?? writeSystemLog;
  const started = now();
  const deadline = started + runtime.waitTimeoutMs;
  const intervalMs = Math.max(1, runtime.healthIntervalMs);
  const timeoutSec = Math.round(runtime.waitTimeoutMs / 1000);
  let spentAttempts = 0;
  let lastError = 'health check failed';

  while (true) {
    if (runtime.signal.aborted) {
      throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    }

    spentAttempts += 1;
    const result = await probe(service);
    if (result.ok) {
      if (spentAttempts > 1) {
        const message = formatDependencyWaitRecovered({
          service,
          spentAttempts: spentAttempts - 1,
        });
        await logWait(runtime, writeLog, 'info', message, {
          service,
          spentAttempts: spentAttempts - 1,
          remainingAttempts: 0,
        });
        runtime.mergeSnapshot({ waitingFor: null, waitAttempt: null, waitRemaining: null });
      }
      return;
    }

    lastError = result.error;
    const remaining = remainingAttemptsAfterFail(deadline, now(), intervalMs);
    const message = formatDependencyWaitFailed({
      service,
      spentAttempts,
      remainingAttempts: remaining,
      error: lastError,
    });
    await logWait(runtime, writeLog, 'error', message, {
      service,
      spentAttempts,
      remainingAttempts: remaining,
      error: lastError,
      timeoutSec,
      intervalSec: Math.round(intervalMs / 1000),
    });
    runtime.mergeSnapshot({
      waitingFor: service,
      waitAttempt: spentAttempts,
      waitRemaining: remaining,
    });
    runtime.emit({
      type: 'dependency-wait',
      jobId: runtime.jobId,
      service,
      error: lastError,
      spentAttempts,
      remainingAttempts: remaining,
    });

    if (remaining <= 0 || now() >= deadline) {
      const exhausted = formatDependencyWaitExhausted({
        service,
        spentAttempts,
        timeoutSec,
        error: lastError,
      });
      await logWait(runtime, writeLog, 'error', exhausted, {
        service,
        spentAttempts,
        remainingAttempts: 0,
        error: lastError,
        timeoutSec,
      });
      throw new DependencyUnavailableError(service, spentAttempts, lastError);
    }

    const sleepMs = Math.min(intervalMs, Math.max(0, deadline - now()));
    await sleep(sleepMs, runtime.signal);
  }
};

/**
 * Before an LLM/TTS request: probe health and wait (with pauses) until ready
 * or the configured timeout elapses. No-op outside a job runtime.
 */
export const ensureDependencyHealthy = async (
  service: DependencyService,
  deps: WaitForHealthyDeps = {},
): Promise<void> => {
  const runtime = getJobRuntime();
  if (!runtime) return;

  const existing = runtime.inflightWaits.get(service);
  if (existing) return existing;

  const promise = waitUntilHealthy(service, runtime, deps).finally(() => {
    runtime.inflightWaits.delete(service);
  });
  runtime.inflightWaits.set(service, promise);
  try {
    await promise;
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw err;
  }
};

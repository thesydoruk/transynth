/**
 * Runs one claimed BullMQ job through its registered handler.
 *
 * Three side-channels leave the worker while a job runs:
 *   • `job.updateProgress(event)` — live SSE via QueueEvents on the API
 *   • Redis snapshot (throttled) — status GET / reopened modal catch-up
 *   • control channel — Stop aborts `signal`; Pause calls the import hook
 */
import type { Job } from 'bullmq';
import type { Tx } from '../../src/db';
import { syncLlmPoolFromProjectSettings } from '../../src/llm/llmProjectSettings';
import { logJobs } from '../../src/logging/loggers';
import { runWithJobRuntime } from '../../src/pipeline/jobRuntime';
import {
  clampDependencyWaitTimeoutSec,
  clampHealthCheckIntervalSec,
} from '../../src/pipeline/settings';
import { syncTtsPoolFromProjectSettings } from '../../src/voice/voiceProjectSettings';
import { getAllProjectSettings } from '../../src/web/services/projectSettings';
import { writeSystemLog } from '../../src/web/services/systemLog';
import { fromBullJobId } from './core/queue';
import { writeJobSnapshot } from './core/snapshots';
import { getJobHandler } from './registry';
import type { JobContext, JobData, JobResult } from './types';

/** How often a dirty running snapshot is flushed to Redis. */
const SNAPSHOT_FLUSH_MS = 1000;

type ActiveRun = { cancel: () => void; pause: () => void };

/** In-flight jobs on this process — keyed for control-channel delivery. */
const activeRuns = new Map<number, ActiveRun>();

/** Deliver a cancel/pause from the control subscription (or ignore if unknown). */
export const controlActiveRun = (jobId: number, action: 'cancel' | 'pause'): void => {
  const run = activeRuns.get(jobId);
  if (!run) return;
  if (action === 'cancel') run.cancel();
  else run.pause();
};

/** Abort every in-flight job (worker shutdown). */
export const cancelAllActiveRuns = (): void => {
  for (const run of activeRuns.values()) run.cancel();
};

export const processJob = async (db: Tx, job: Job<JobData>): Promise<void> => {
  const jobId = fromBullJobId(job.id);
  if (jobId == null) {
    throw new Error(`Invalid BullMQ job id: ${job.id ?? '(missing)'}`);
  }
  const { kind, modId } = job.data;
  const handler = getJobHandler(kind);

  const projectSettings = await getAllProjectSettings(db);
  syncTtsPoolFromProjectSettings(projectSettings);
  syncLlmPoolFromProjectSettings(projectSettings);

  const abort = new AbortController();
  let cancelled = false;
  let done = 0;
  let total = 0;
  let snapshotData: Record<string, unknown> = {};
  let snapshotDirty = false;

  // Serialise Redis writes: progress events must arrive in emit order, and a
  // periodic snapshot must never overwrite the terminal one written later.
  let eventChain: Promise<unknown> = Promise.resolve();
  let snapshotChain: Promise<unknown> = Promise.resolve();

  const pushSnapshot = (status: JobResult['status'] | 'running', error: string | null): void => {
    const payload = { jobId, kind, modId, status, done, total, error, data: snapshotData };
    snapshotChain = snapshotChain.then(() => writeJobSnapshot(payload)).catch(() => undefined);
  };

  const flushTimer = setInterval(() => {
    if (!snapshotDirty) return;
    snapshotDirty = false;
    pushSnapshot('running', null);
  }, SNAPSHOT_FLUSH_MS);

  let pauseHandler: () => void = () => undefined;
  activeRuns.set(jobId, {
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      abort.abort();
    },
    pause: () => pauseHandler(),
  });

  const ctx: JobContext = {
    jobId,
    data: job.data,
    signal: abort.signal,
    isCancelled: () => cancelled,
    emit: (event) => {
      if (typeof event.done === 'number') done = event.done;
      if (typeof event.total === 'number') total = event.total;
      snapshotDirty = true;
      eventChain = eventChain
        .then(() => job.updateProgress(event))
        .catch((err) =>
          logJobs.debug(
            `progress publish failed for #${jobId}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    },
    mergeSnapshot: (data) => {
      snapshotData = { ...snapshotData, ...data };
      if (typeof data.done === 'number') done = data.done;
      if (typeof data.total === 'number') total = data.total;
      snapshotDirty = true;
    },
    onPause: (handler) => {
      pauseHandler = handler;
    },
  };

  logJobs.info('job started', { jobId, kind, modId });
  pushSnapshot('running', null);

  try {
    const result = await runWithJobRuntime(
      {
        db,
        jobId,
        kind,
        modId,
        emit: ctx.emit,
        mergeSnapshot: ctx.mergeSnapshot,
        signal: abort.signal,
        waitTimeoutMs:
          clampDependencyWaitTimeoutSec(projectSettings['pipeline.dependency_wait_timeout_sec']) *
          1000,
        healthIntervalMs:
          clampHealthCheckIntervalSec(projectSettings['pipeline.health_check_interval_sec']) * 1000,
        inflightWaits: new Map(),
      },
      () => handler(db, ctx),
    );
    if (result.done != null) done = result.done;
    if (result.total != null) total = result.total;
    pushSnapshot(result.status, result.error ?? null);
    if (result.status === 'failed' && result.error) {
      await writeSystemLog(db, {
        level: 'error',
        source: 'job',
        message: `Job ${kind} #${jobId} failed: ${result.error}`,
        jobId,
        jobKind: kind,
        modId,
      });
    }
    logJobs.info('job finished', { jobId, kind, modId, status: result.status, done, total });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pushSnapshot(cancelled ? 'cancelled' : 'failed', message);
    if (!cancelled) {
      await writeSystemLog(db, {
        level: 'error',
        source: 'job',
        message: `Job ${kind} #${jobId} failed: ${message}`,
        jobId,
        jobKind: kind,
        modId,
      });
    }
    logJobs.error('job failed', { jobId, kind, modId, error: message });
    // Rethrow so BullMQ marks the job failed and the SSE relay reports it.
    throw err;
  } finally {
    clearInterval(flushTimer);
    activeRuns.delete(jobId);
    await eventChain;
    await snapshotChain;
  }
};

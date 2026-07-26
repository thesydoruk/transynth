/**
 * Bridges a domain `run*Job(db, opts, onEvent)` service into BullMQ JobContext.
 *
 * The service already speaks the SSE event shapes the UI expects. This helper:
 *   • stamps every event with the BullMQ `jobId`
 *   • publishes via `ctx.emit` (→ QueueEvents → browser)
 *   • merges the final snapshot for status GETs
 *   • optionally accumulates mid-run data (rows, issues) into Redis via `onProgress`
 *
 * Cancellation is not handled here — callers pass `ctx.signal` / `ctx.isCancelled`
 * straight into the service options.
 */
import type { JobContext, JobEvent, JobResult, JobSnapshotStatus } from './types';

type ServiceSnapshot = {
  status: JobSnapshotStatus | 'running';
  done: number;
  total: number;
  error: string | null;
} & Record<string, unknown>;

export const runTrackedJob = async <E extends { type: string }, S extends ServiceSnapshot>(
  ctx: JobContext,
  run: (onEvent: (event: E) => void) => Promise<S>,
  /** Optional: accumulate rows/issues into the Redis snapshot while the job runs. */
  onProgress?: (event: E) => void,
): Promise<JobResult> => {
  const finalSnapshot = await run((event) => {
    ctx.emit({ ...(event as object as JobEvent), jobId: ctx.jobId });
    onProgress?.(event);
  });
  ctx.mergeSnapshot({ ...finalSnapshot, jobId: ctx.jobId });
  return {
    status: finalSnapshot.status === 'running' ? 'completed' : finalSnapshot.status,
    error: finalSnapshot.error,
    done: finalSnapshot.done,
    total: finalSnapshot.total,
  };
};

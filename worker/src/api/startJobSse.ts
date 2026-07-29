/**
 * Start a background job and stream its progress to the browser.
 *
 * Used by every "run with SSE" route. Order matters:
 *   1. allocate a job id
 *   2. open SSE + subscribe to QueueEvents for that id
 *   3. write an initial Redis snapshot (so status GET works immediately)
 *   4. enqueue — the worker may emit `started` almost instantly
 *
 * The response protocol matches the old in-process SSE routes: handler events
 * verbatim, `{ type: 'error' }` on failure, then stream end. Disconnecting the
 * browser does not stop the job.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { allocateJobId, enqueueJob, toBullJobId } from '../core/queue';
import { getJobsQueueEvents } from '../core/queueEvents';
import { writeJobSnapshot } from '../core/snapshots';
import type { JobData } from '../types';
import { openSseStream, type SseStream } from './sse';

/** Forward one job's BullMQ progress/completed/failed/removed into an SSE stream. */
export const relayJobToSse = (jobId: number, stream: SseStream): void => {
  const events = getJobsQueueEvents();
  const id = toBullJobId(jobId);

  const onProgress = (args: { jobId: string; data: unknown }): void => {
    if (args.jobId !== id) return;
    if (args.data && typeof args.data === 'object') stream.send(args.data);
  };
  const onCompleted = (args: { jobId: string }): void => {
    if (args.jobId === id) finish();
  };
  const onFailed = (args: { jobId: string; failedReason: string }): void => {
    if (args.jobId !== id) return;
    stream.send({ type: 'error', error: args.failedReason || 'Job failed' });
    finish();
  };
  const onRemoved = (args: { jobId: string }): void => {
    // Stop of a still-queued job removes it without completed/failed events.
    if (args.jobId === id) finish();
  };

  const cleanup = (): void => {
    events.off('progress', onProgress);
    events.off('completed', onCompleted);
    events.off('failed', onFailed);
    events.off('removed', onRemoved);
  };
  const finish = (): void => {
    cleanup();
    stream.end();
  };

  events.on('progress', onProgress);
  events.on('completed', onCompleted);
  events.on('failed', onFailed);
  events.on('removed', onRemoved);
  stream.onClose(cleanup);
};

export type StartJobSseOptions = {
  data: JobData;
  /**
   * Seed for the Redis snapshot before the worker writes its first one
   * (e.g. `{ rows: [] }`) so a status GET right after start still answers 200.
   */
  initialSnapshotData?: Record<string, unknown>;
};

export const startJobSse = async (
  req: FastifyRequest,
  reply: FastifyReply,
  opts: StartJobSseOptions,
): Promise<void> => {
  const jobId = await allocateJobId();
  const stream = openSseStream(req, reply);
  relayJobToSse(jobId, stream);

  await writeJobSnapshot({
    jobId,
    kind: opts.data.kind,
    modId: opts.data.modId,
    status: 'running',
    done: 0,
    total: 0,
    error: null,
    data: { jobId, modId: opts.data.modId, ...(opts.initialSnapshotData ?? {}) },
  });

  try {
    await enqueueJob(opts.data, jobId);
  } catch (err) {
    stream.send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
    stream.end();
  }
};

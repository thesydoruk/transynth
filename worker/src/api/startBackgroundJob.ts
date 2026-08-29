/**
 * Enqueue a job and return its id immediately (no SSE hold).
 * The browser can leave the page; status lives in Redis + domain tables.
 */
import { allocateJobId, enqueueJob } from '../core/queue';
import { writeJobSnapshot } from '../core/snapshots';
import type { JobData } from '../types';

export const startBackgroundJob = async (
  data: JobData,
  initialSnapshotData?: Record<string, unknown>,
): Promise<number> => {
  const jobId = await allocateJobId();
  await writeJobSnapshot({
    jobId,
    kind: data.kind,
    modId: data.modId,
    status: 'running',
    done: 0,
    total: 0,
    error: null,
    data: { jobId, modId: data.modId, ...(initialSnapshotData ?? {}) },
  });
  await enqueueJob(data, jobId);
  return jobId;
};

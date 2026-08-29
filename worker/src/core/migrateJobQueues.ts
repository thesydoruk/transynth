/**
 * Move leftover unfinished jobs onto the queue that {@link queueNameForKind}
 * assigns — used once at worker boot after the voice/LLM split.
 */
import type { Job } from 'bullmq';
import { logJobs } from '../../../src/logging/loggers';
import type { JobData } from '../types';
import { fromBullJobId, toBullJobId } from './jobId';
import { queueNameForKind } from './queueNames';
import { getQueueByName, listUnfinishedJobs } from './queue';

export type MigrateJobQueuesDeps = {
  listUnfinished?: () => Promise<Job<JobData>[]>;
  enqueueOnQueue?: (queueName: string, data: JobData, jobId: number) => Promise<void>;
  dropJob?: (job: Job<JobData>) => Promise<void>;
  queueNameOf?: (job: Job<JobData>) => string | undefined;
  log?: Pick<typeof logJobs, 'info' | 'warn'>;
};

const jobQueueName = (job: Job<JobData>): string | undefined => job.queueName;

const dropMisplacedJob = async (job: Job<JobData>): Promise<void> => {
  try {
    await job.remove();
    return;
  } catch {
    /* still locked / active */
  }
  try {
    await job.moveToFailed(new Error('moved to dedicated queue'), '0');
  } catch {
    try {
      await job.remove();
    } catch {
      /* already gone */
    }
  }
};

const enqueueOnDedicatedQueue = async (
  queueName: string,
  data: JobData,
  jobId: number,
): Promise<void> => {
  await getQueueByName(queueName).add(data.kind, data, { jobId: toBullJobId(jobId) });
};

/** Re-home unfinished jobs that still sit on the pre-split general queue. */
export const migrateJobsToDedicatedQueues = async (
  deps: MigrateJobQueuesDeps = {},
): Promise<number> => {
  const listUnfinished = deps.listUnfinished ?? (() => listUnfinishedJobs());
  const enqueueOnQueue = deps.enqueueOnQueue ?? enqueueOnDedicatedQueue;
  const dropJob = deps.dropJob ?? dropMisplacedJob;
  const queueNameOf = deps.queueNameOf ?? jobQueueName;
  const log = deps.log ?? logJobs;

  let moved = 0;
  for (const job of await listUnfinished()) {
    if (!job) continue;
    const dest = queueNameForKind(job.data.kind);
    const source = queueNameOf(job);
    if (source === dest) continue;
    const jobId = fromBullJobId(job.id);
    if (jobId == null) continue;
    try {
      await enqueueOnQueue(dest, job.data, jobId);
    } catch (err) {
      log.warn('migrate enqueue failed', {
        jobId,
        kind: job.data.kind,
        dest,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    await dropJob(job);
    log.info('migrated job to dedicated queue', {
      jobId,
      kind: job.data.kind,
      from: source ?? '(unknown)',
      to: dest,
    });
    moved += 1;
  }
  return moved;
};

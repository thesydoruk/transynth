/**
 * Close Vortex runs the worker left behind.
 *
 * A deploy stops the worker with SIGTERM in the middle of an import; the job's
 * handler never reaches its catch, the run row stays `running`, and the group
 * refuses every next stage with 409 for ever. Two hooks end such a run with a
 * reason: on start the worker fails every unfinished run whose job is gone or
 * finished, and when BullMQ fails a job it did not get to finish (a stalled
 * lock after a crash) the run learns that too. A run whose job is still
 * queued or active is left alone: BullMQ, or another worker, still owns it.
 */
import type { Job } from 'bullmq';
import type { Tx } from '../../../src/db';
import { logJobs } from '../../../src/logging/loggers';
import { getVortexSyncRun, updateVortexSyncRun } from '../../../src/vortex/db';
import { listUnfinishedVortexRuns, type VortexSyncRunHistoryRow } from '../../../src/vortex/dbRuns';
import type { JobData } from '../types';
import { getQueueJob } from './queue';

export type RecoverVortexRunsDeps = {
  getQueueJob?: typeof getQueueJob;
  log?: Pick<typeof logJobs, 'info' | 'warn'>;
};

const LIVE_STATES = new Set([
  'active',
  'waiting',
  'waiting-children',
  'delayed',
  'prioritized',
  'paused',
]);
const UNFINISHED = new Set(['queued', 'running']);

const stageOf = (run: VortexSyncRunHistoryRow): string =>
  run.current_stage ?? run.stage ?? 'the run';

/** On start: fail every unfinished run whose job BullMQ no longer runs. */
export const recoverInterruptedVortexRuns = async (
  db: Tx,
  deps: RecoverVortexRunsDeps = {},
): Promise<number> => {
  const findJob = deps.getQueueJob ?? getQueueJob;
  const log = deps.log ?? logJobs;
  let closed = 0;
  for (const run of await listUnfinishedVortexRuns(db)) {
    if (run.job_id == null) continue;
    const job = await findJob(run.job_id);
    const state = job ? await job.getState() : 'missing';
    if (LIVE_STATES.has(state)) continue;
    const stage = stageOf(run);
    const error = `worker restarted while ${stage} was running (job ${run.job_id} ${state})`;
    await updateVortexSyncRun(db, run.id, { status: 'failed', error });
    log.warn('closed interrupted Vortex run', { runId: run.id, stage, jobId: run.job_id, state });
    closed += 1;
  }
  return closed;
};

/** BullMQ failed a vortex-sync job outside its handler: the run records why. */
export const failVortexRunForJob = async (
  db: Tx,
  job: Job<JobData>,
  err: Error,
  deps: RecoverVortexRunsDeps = {},
): Promise<boolean> => {
  if (job.data.kind !== 'vortex-sync') return false;
  const runId = (job.data.params as { runId?: unknown } | undefined)?.runId;
  if (typeof runId !== 'number') return false;
  const run = await getVortexSyncRun(db, runId);
  if (!run || !UNFINISHED.has(run.status)) return false;
  await updateVortexSyncRun(db, runId, { status: 'failed', error: err.message });
  (deps.log ?? logJobs).warn('Vortex run failed with its job', { runId, error: err.message });
  return true;
};

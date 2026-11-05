import { describe, expect, it, jest } from '@jest/globals';
import type { Job } from 'bullmq';
import type { Tx } from '../../../../src/db';
import type { JobData } from '../../types';
import { failVortexRunForJob, recoverInterruptedVortexRuns } from '../recoverVortexRuns';

type RunRow = {
  id: number;
  status: string;
  current_stage: string | null;
  stage: string | null;
  job_id: number | null;
};

/** A db whose SELECTs answer from `runs` and whose UPDATEs are recorded. */
const makeDb = (runs: RunRow[]) => {
  const updates: Array<{ id: number; status: string | null; error: string | null }> = [];
  const db = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (/^\s*UPDATE vortex_sync_runs/.test(sql)) {
        updates.push({
          id: params[0] as number,
          status: params[1] as string | null,
          error: params[7] as string | null,
        });
        return { rows: [] };
      }
      if (/WHERE id = \$1/.test(sql)) {
        return { rows: runs.filter((run) => run.id === params[0]) };
      }
      return { rows: runs.filter((run) => run.status === 'queued' || run.status === 'running') };
    }),
  } as unknown as Tx;
  return { db, updates };
};

const jobInState = (state: string): Job<JobData> =>
  ({ getState: async () => state }) as unknown as Job<JobData>;

const log = { info: jest.fn(), warn: jest.fn() };

describe('recoverInterruptedVortexRuns', () => {
  it('fails runs whose job is gone or finished and leaves live ones alone', async () => {
    const { db, updates } = makeDb([
      { id: 21, status: 'running', current_stage: 'import', stage: null, job_id: 1653 },
      { id: 22, status: 'running', current_stage: null, stage: 'tm', job_id: 1660 },
      { id: 23, status: 'queued', current_stage: null, stage: null, job_id: 1661 },
      { id: 24, status: 'running', current_stage: 'carry', stage: null, job_id: 1662 },
      { id: 19, status: 'completed', current_stage: null, stage: null, job_id: 1600 },
    ]);
    const jobs: Record<number, Job<JobData> | undefined> = {
      1660: jobInState('failed'),
      1661: jobInState('waiting'),
      1662: jobInState('active'),
    };

    const closed = await recoverInterruptedVortexRuns(db, {
      getQueueJob: async (id) => jobs[id],
      log,
    });

    expect(closed).toBe(2);
    expect(updates).toEqual([
      {
        id: 21,
        status: 'failed',
        error: 'worker restarted while import was running (job 1653 missing)',
      },
      {
        id: 22,
        status: 'failed',
        error: 'worker restarted while tm was running (job 1660 failed)',
      },
    ]);
  });
});

describe('failVortexRunForJob', () => {
  const vortexJob = (runId: unknown, kind: JobData['kind'] = 'vortex-sync'): Job<JobData> =>
    ({ id: 'job-1653', data: { kind, modId: null, params: { runId } } }) as unknown as Job<JobData>;

  it('writes the failure into a run that is still running', async () => {
    const { db, updates } = makeDb([
      { id: 21, status: 'running', current_stage: 'import', stage: null, job_id: 1653 },
    ]);
    const stalled = new Error('job stalled more than allowable limit');

    expect(await failVortexRunForJob(db, vortexJob(21), stalled, { log })).toBe(true);
    expect(updates).toEqual([{ id: 21, status: 'failed', error: stalled.message }]);
  });

  it('ignores other kinds and runs the handler already closed', async () => {
    const { db, updates } = makeDb([
      { id: 21, status: 'failed', current_stage: null, stage: null, job_id: 1653 },
    ]);
    const err = new Error('boom');

    expect(await failVortexRunForJob(db, vortexJob(21), err, { log })).toBe(false);
    expect(await failVortexRunForJob(db, vortexJob(21, 'tm-apply'), err, { log })).toBe(false);
    expect(updates).toEqual([]);
  });
});

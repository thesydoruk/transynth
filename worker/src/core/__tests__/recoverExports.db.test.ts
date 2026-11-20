import { describe, expect, it, jest } from '@jest/globals';
import type { Job } from 'bullmq';
import type { JobData } from '../../types';

const { MAX_EXPORT_RESTARTS, recoverExportForFailedJob, recoverInterruptedExports } =
  await import('../recoverExports');
const { getExportArchive, insertExportArchive, setExportArchiveJobId } =
  await import('../../../../src/web/data/queries/exportArchives');
const { useTestDb } = await import('../../../../src/testing/testDb');

const STALLED = 'job stalled more than allowable limit';

const exportData = (archiveId: number, restarts?: number): JobData => ({
  kind: 'langpack-export',
  modId: null,
  params: { archiveId, srcLang: 'en', targetLang: 'uk', ...(restarts ? { restarts } : {}) },
});

const bullJob = (
  jobId: number,
  data: JobData,
  state = 'failed',
  failedReason = STALLED,
): Job<JobData> =>
  ({
    id: `job-${jobId}`,
    data,
    failedReason,
    getState: async () => state,
  }) as unknown as Job<JobData>;

describe('interrupted langpack exports', () => {
  const db = useTestDb();

  const newArchive = async (jobId: number | null) => {
    const archive = await insertExportArchive(db(), {
      game: 'fo4',
      srcLang: 'en',
      tgtLang: 'uk',
      label: 'Fallout4 +6',
      fileName: 'fo4_uk_langpack.zip',
      modIds: [1],
      totalCount: 1,
    });
    if (jobId != null) await setExportArchiveJobId(db(), archive.id, jobId);
    return archive.id;
  };

  /** Deps that record what the recovery enqueued and deleted instead of doing it. */
  const makeDeps = (jobs: Record<number, Job<JobData>> = {}) => {
    const enqueued: Array<{ jobId: number; data: JobData }> = [];
    const removed: number[] = [];
    let nextJobId = 9000;
    const deps = {
      getQueueJob: async (id: number) => jobs[id],
      allocateJobId: async () => (nextJobId += 1),
      enqueueJob: async (data: JobData, jobId: number) => {
        enqueued.push({ jobId, data });
      },
      writeSnapshot: jest.fn(async () => undefined),
      removeFiles: (archiveId: number) => {
        removed.push(archiveId);
      },
      log: { info: jest.fn(), warn: jest.fn() },
    };
    return { deps, enqueued, removed };
  };

  const notRunningHere = () => false;

  // The 2026-11-20 incident: a deploy stopped the worker 11 s into an export.
  it('starts a UI export again when BullMQ fails its job as stalled', async () => {
    const id = await newArchive(2670);
    const { deps, enqueued, removed } = makeDeps();

    const outcome = await recoverExportForFailedJob(
      db(),
      bullJob(2670, exportData(id)),
      new Error(STALLED),
      notRunningHere,
      deps,
    );

    expect(outcome).toBe('restarted');
    expect(enqueued).toEqual([{ jobId: 9001, data: exportData(id, 1) }]);
    expect(removed).toEqual([id]);
    const archive = await getExportArchive(db(), id);
    expect(archive).toMatchObject({ status: 'running', job_id: 9001, done_count: 0 });
  });

  it('leaves an export whose handler still runs in this process', async () => {
    const id = await newArchive(2670);
    const { deps, enqueued, removed } = makeDeps();

    const outcome = await recoverExportForFailedJob(
      db(),
      bullJob(2670, exportData(id)),
      new Error(STALLED),
      (jobId) => jobId === 2670,
      deps,
    );

    expect(outcome).toBe('left');
    expect(enqueued).toEqual([]);
    expect(removed).toEqual([]);
    expect(await getExportArchive(db(), id)).toMatchObject({ status: 'running', job_id: 2670 });
  });

  it('enqueues once when two recoveries see the same stalled job', async () => {
    const id = await newArchive(2670);
    const { deps, enqueued } = makeDeps();
    const job = bullJob(2670, exportData(id));

    const first = await recoverExportForFailedJob(
      db(),
      job,
      new Error(STALLED),
      notRunningHere,
      deps,
    );
    const second = await recoverExportForFailedJob(
      db(),
      job,
      new Error(STALLED),
      notRunningHere,
      deps,
    );

    expect([first, second]).toEqual(['restarted', 'left']);
    expect(enqueued).toHaveLength(1);
  });

  it('gives up on an export that keeps taking the worker down', async () => {
    const id = await newArchive(2670);
    const { deps, enqueued, removed } = makeDeps();

    const outcome = await recoverExportForFailedJob(
      db(),
      bullJob(2670, exportData(id, MAX_EXPORT_RESTARTS)),
      new Error(STALLED),
      notRunningHere,
      deps,
    );

    expect(outcome).toBe('failed');
    expect(enqueued).toEqual([]);
    expect(removed).toEqual([id]);
    expect(await getExportArchive(db(), id)).toMatchObject({
      status: 'failed',
      error: 'export was cut short by a worker restart 3 times in a row',
    });
  });

  it('fails the archive with the error of a job that failed for another reason', async () => {
    const id = await newArchive(2670);
    const { deps, enqueued } = makeDeps();

    const outcome = await recoverExportForFailedJob(
      db(),
      bullJob(2670, exportData(id)),
      new Error('Cancelled by user'),
      notRunningHere,
      deps,
    );

    expect(outcome).toBe('failed');
    expect(enqueued).toEqual([]);
    expect(await getExportArchive(db(), id)).toMatchObject({
      status: 'failed',
      error: 'Cancelled by user',
    });
  });

  it('fails the archive of a Vortex run with its job and never restarts it', async () => {
    const id = await newArchive(2700);
    const other = await newArchive(2701);
    const { deps, enqueued, removed } = makeDeps();
    const vortexJob = bullJob(2700, { kind: 'vortex-sync', modId: null, params: { runId: 5 } });

    const outcome = await recoverExportForFailedJob(
      db(),
      vortexJob,
      new Error(STALLED),
      notRunningHere,
      deps,
    );

    expect(outcome).toBe('failed');
    expect(enqueued).toEqual([]);
    expect(removed).toEqual([id]);
    expect(await getExportArchive(db(), id)).toMatchObject({ status: 'failed', error: STALLED });
    expect(await getExportArchive(db(), other)).toMatchObject({ status: 'running' });
  });

  it('ignores other job kinds and archives another job owns', async () => {
    const id = await newArchive(2671);
    const { deps, enqueued } = makeDeps();
    const err = new Error(STALLED);
    const tm = bullJob(2670, { kind: 'tm-apply', modId: 1, params: { archiveId: id } });

    expect(await recoverExportForFailedJob(db(), tm, err, notRunningHere, deps)).toBe('left');
    expect(
      await recoverExportForFailedJob(
        db(),
        bullJob(2670, exportData(id)),
        err,
        notRunningHere,
        deps,
      ),
    ).toBe('left');
    expect(enqueued).toEqual([]);
    expect(await getExportArchive(db(), id)).toMatchObject({ status: 'running', job_id: 2671 });
  });

  it('on start closes every running archive whose job is gone or finished', async () => {
    const stalled = await newArchive(2670);
    const missing = await newArchive(2671);
    const noJob = await newArchive(null);
    const vortex = await newArchive(2672);
    const active = await newArchive(2673);
    const waiting = await newArchive(2674);
    const { deps, enqueued, removed } = makeDeps({
      2670: bullJob(2670, exportData(stalled)),
      2672: bullJob(2672, { kind: 'vortex-sync', modId: null, params: { runId: 5 } }),
      2673: bullJob(2673, exportData(active), 'active', ''),
      2674: bullJob(2674, exportData(waiting), 'waiting', ''),
    });

    expect(await recoverInterruptedExports(db(), deps)).toBe(4);

    expect(enqueued).toEqual([{ jobId: 9001, data: exportData(stalled, 1) }]);
    expect(removed.sort()).toEqual([stalled, missing, noJob, vortex].sort());
    const state = async (id: number) => {
      const row = await getExportArchive(db(), id);
      return { status: row?.status, job_id: row?.job_id, error: row?.error };
    };
    expect(await state(stalled)).toEqual({ status: 'running', job_id: 9001, error: null });
    expect(await state(missing)).toEqual({
      status: 'failed',
      job_id: 2671,
      error: 'worker restarted during the export (job 2671 missing)',
    });
    expect(await state(noJob)).toEqual({
      status: 'failed',
      job_id: null,
      error: 'worker restarted during the export (job unknown missing)',
    });
    expect(await state(vortex)).toEqual({
      status: 'failed',
      job_id: 2672,
      error: 'worker restarted during the export (job 2672 failed)',
    });
    expect(await state(active)).toEqual({ status: 'running', job_id: 2673, error: null });
    expect(await state(waiting)).toEqual({ status: 'running', job_id: 2674, error: null });
  });
});

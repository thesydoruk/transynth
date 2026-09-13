import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import type { Job } from 'bullmq';
import type { JobData, JobSnapshot } from '../../types';

const listUnfinishedJobsForMod =
  jest.fn<(kinds: readonly string[], modId: number) => Promise<Job<JobData>[]>>();
const removeIdleQueueJob = jest.fn<(job: Job<JobData>) => Promise<boolean>>();
const requestJobStop = jest.fn<(jobId: number) => Promise<boolean>>();
const getQueueJob = jest.fn<(jobId: number) => Promise<Job<JobData> | undefined>>();
const readJobSnapshot = jest.fn<(jobId: number) => Promise<JobSnapshot | null>>();
const isJobMarkedCancelled = jest.fn<(jobId: number) => Promise<boolean>>();
const markJobCancelled = jest.fn<(jobId: number) => Promise<void>>();
const writeJobSnapshot = jest.fn<(snapshot: JobSnapshot) => Promise<void>>();
const publishJobControl = jest.fn<(jobId: number, action: string) => Promise<void>>();

jest.unstable_mockModule('../../core/queue', () => ({
  fromBullJobId: (id: string | undefined | null) => {
    if (id == null || id === '') return null;
    const prefixed = /^job-(\d+)$/.exec(id);
    if (prefixed) return Number(prefixed[1]);
    return /^\d+$/.test(id) ? Number(id) : null;
  },
  getQueueJob,
  isIdleQueueState: (state: string) =>
    ['wait', 'waiting', 'delayed', 'prioritized', 'paused', 'waiting-children'].includes(state),
  listUnfinishedJobsForMod,
  removeIdleQueueJob,
  requestJobStop,
}));

jest.unstable_mockModule('../../core/snapshots', () => ({
  readJobSnapshot,
  isJobMarkedCancelled,
  markJobCancelled,
  writeJobSnapshot,
}));

jest.unstable_mockModule('../../core/controlChannel', () => ({
  publishJobControl,
}));

const { classifyUnfinishedJob, findActiveJobIdForMod, stopJobForMod, stopJobOfKind } =
  await import('../jobStatus');

const translateJob = (id: number): Job<JobData> =>
  ({
    id: `job-${id}`,
    data: { kind: 'llm-translate', modId: 42, params: {} },
    getState: jest.fn(async () => 'active'),
  }) as unknown as Job<JobData>;

const snapshot = (jobId: number, status: JobSnapshot['status']): JobSnapshot => ({
  jobId,
  kind: 'llm-translate',
  modId: 42,
  status,
  done: 0,
  total: 0,
  error: null,
  data: {},
});

describe('classifyUnfinishedJob', () => {
  it('blocks a running active job', () => {
    expect(
      classifyUnfinishedJob({
        snapshotStatus: 'running',
        cancelledFlag: false,
        queueState: 'active',
      }),
    ).toBe('block');
  });

  it('skips a cancelled job that is still active (handler draining)', () => {
    expect(
      classifyUnfinishedJob({
        snapshotStatus: 'cancelled',
        cancelledFlag: false,
        queueState: 'active',
      }),
    ).toBe('skip');
  });

  it('discards a cancelled leftover that is still waiting', () => {
    expect(
      classifyUnfinishedJob({
        snapshotStatus: 'cancelled',
        cancelledFlag: false,
        queueState: 'waiting',
      }),
    ).toBe('discard');
  });

  it('skips an active job whose snapshot expired but cancel flag remains', () => {
    expect(
      classifyUnfinishedJob({
        snapshotStatus: null,
        cancelledFlag: true,
        queueState: 'active',
      }),
    ).toBe('skip');
  });

  it('discards a waiting job with no snapshot (zombie leftover)', () => {
    expect(
      classifyUnfinishedJob({
        snapshotStatus: null,
        cancelledFlag: false,
        queueState: 'delayed',
      }),
    ).toBe('discard');
  });

  it('blocks an active job with no snapshot (treat as still running)', () => {
    expect(
      classifyUnfinishedJob({
        snapshotStatus: null,
        cancelledFlag: false,
        queueState: 'active',
      }),
    ).toBe('block');
  });
});

describe('findActiveJobIdForMod', () => {
  beforeEach(() => {
    listUnfinishedJobsForMod.mockReset();
    removeIdleQueueJob.mockReset();
    readJobSnapshot.mockReset();
    isJobMarkedCancelled.mockReset();
    readJobSnapshot.mockResolvedValue(null);
    isJobMarkedCancelled.mockResolvedValue(false);
    removeIdleQueueJob.mockResolvedValue(true);
  });

  it('ignores a cancelled leftover and allows enqueue', async () => {
    const leftover = translateJob(10);
    leftover.getState = jest.fn(async () => 'active') as Job<JobData>['getState'];
    listUnfinishedJobsForMod.mockResolvedValue([leftover]);
    readJobSnapshot.mockResolvedValue(snapshot(10, 'cancelled'));

    await expect(findActiveJobIdForMod(['llm-translate'], 42)).resolves.toBeNull();
    expect(removeIdleQueueJob).not.toHaveBeenCalled();
  });

  it('drops a waiting cancelled leftover and looks at the next job', async () => {
    const leftover = translateJob(11);
    leftover.getState = jest.fn(async () => 'waiting') as Job<JobData>['getState'];
    const running = translateJob(12);
    running.getState = jest.fn(async () => 'waiting') as Job<JobData>['getState'];
    listUnfinishedJobsForMod.mockResolvedValue([leftover, running]);
    readJobSnapshot.mockImplementation(async (jobId: number) =>
      jobId === 11 ? snapshot(11, 'cancelled') : snapshot(12, 'running'),
    );

    await expect(findActiveJobIdForMod(['llm-translate'], 42)).resolves.toEqual({
      jobId: 12,
      kind: 'llm-translate',
    });
    expect(removeIdleQueueJob).toHaveBeenCalledWith(leftover);
  });

  it('does not 409 on the first leftover when a later job is the real runner', async () => {
    const leftover = translateJob(13);
    leftover.getState = jest.fn(async () => 'active') as Job<JobData>['getState'];
    const running = translateJob(14);
    listUnfinishedJobsForMod.mockResolvedValue([leftover, running]);
    readJobSnapshot.mockImplementation(async (jobId: number) =>
      jobId === 13 ? snapshot(13, 'cancelled') : snapshot(14, 'running'),
    );

    await expect(findActiveJobIdForMod(['llm-translate'], 42)).resolves.toEqual({
      jobId: 14,
      kind: 'llm-translate',
    });
  });
});

describe('stopJobForMod', () => {
  beforeEach(() => {
    listUnfinishedJobsForMod.mockReset();
    requestJobStop.mockReset();
    requestJobStop.mockResolvedValue(true);
  });

  it('stops every unfinished leftover, not just the first', async () => {
    listUnfinishedJobsForMod.mockResolvedValue([translateJob(21), translateJob(22)]);

    await expect(stopJobForMod(['llm-translate'], 42)).resolves.toBe(true);
    expect(requestJobStop).toHaveBeenCalledTimes(2);
    expect(requestJobStop).toHaveBeenCalledWith(21);
    expect(requestJobStop).toHaveBeenCalledWith(22);
  });
});

describe('stopJobOfKind', () => {
  beforeEach(() => {
    listUnfinishedJobsForMod.mockReset();
    requestJobStop.mockReset();
    getQueueJob.mockReset();
    readJobSnapshot.mockReset();
    markJobCancelled.mockReset();
    writeJobSnapshot.mockReset();
    requestJobStop.mockResolvedValue(true);
    writeJobSnapshot.mockResolvedValue(undefined);
    markJobCancelled.mockResolvedValue(undefined);
  });

  it('sweeps sibling leftovers for the same mod after stopping the requested id', async () => {
    readJobSnapshot.mockResolvedValue(snapshot(31, 'running'));
    getQueueJob.mockResolvedValue(translateJob(31));
    listUnfinishedJobsForMod.mockResolvedValue([translateJob(31), translateJob(32)]);

    await expect(stopJobOfKind(31, ['llm-translate'])).resolves.toBe(true);
    expect(requestJobStop).toHaveBeenCalledWith(31);
    expect(requestJobStop).toHaveBeenCalledWith(32);
  });
});

import { describe, expect, it, jest } from '@jest/globals';
import type { Job } from 'bullmq';
import type { JobData, JobSnapshot } from '../../types';
import {
  isLlmStallFailure,
  recoverOrphanedLlmJobs,
  requeueStalledLlmJob,
  type RecoverLlmJobsDeps,
} from '../recoverLlmJobs';

const translateData = (modId = 120): JobData => ({
  kind: 'llm-translate',
  modId,
  params: { srcLang: 'en', targetLang: 'uk' },
});

const makeJob = (id: string, data: JobData): Job<JobData> =>
  ({
    id,
    data,
    moveToFailed: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
  }) as unknown as Job<JobData>;

const makeDeps = (overrides: Partial<RecoverLlmJobsDeps> = {}): RecoverLlmJobsDeps => ({
  allocateJobId: jest.fn(async () => 1110),
  enqueueJob: jest.fn(async () => undefined),
  readSnapshot: jest.fn(async () => null),
  writeSnapshot: jest.fn(async () => undefined),
  findUnfinished: jest.fn(async () => null),
  log: { info: jest.fn(), warn: jest.fn() },
  ...overrides,
});

describe('recoverOrphanedLlmJobs', () => {
  it('re-enqueues an active running translate and fails the old snapshot', async () => {
    const job = makeJob('job-1108', translateData());
    const oldSnap: JobSnapshot = {
      jobId: 1108,
      kind: 'llm-translate',
      modId: 120,
      status: 'running',
      done: 178,
      total: 15153,
      error: null,
      data: {},
    };
    const deps = makeDeps({
      getActiveJobs: async () => [job],
      readSnapshot: jest.fn(async () => oldSnap),
    });

    await expect(recoverOrphanedLlmJobs(deps)).resolves.toBe(1);
    expect(job.moveToFailed).toHaveBeenCalled();
    expect(deps.writeSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 1108, status: 'failed', error: 'worker restarted' }),
    );
    expect(deps.enqueueJob).toHaveBeenCalledWith(translateData(), 1110);
    expect(deps.writeSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 1110, status: 'running', kind: 'llm-translate' }),
    );
  });

  it('drops a cancelled orphan without re-enqueueing', async () => {
    const job = makeJob('job-1106', translateData());
    const deps = makeDeps({
      getActiveJobs: async () => [job],
      readSnapshot: jest.fn(
        async (): Promise<JobSnapshot> => ({
          jobId: 1106,
          kind: 'llm-translate',
          modId: 120,
          status: 'cancelled',
          done: 4847,
          total: 19942,
          error: null,
          data: {},
        }),
      ),
    });

    await expect(recoverOrphanedLlmJobs(deps)).resolves.toBe(0);
    expect(job.moveToFailed).toHaveBeenCalled();
    expect(deps.enqueueJob).not.toHaveBeenCalled();
  });

  it('leaves non-LLM active jobs alone', async () => {
    const job = makeJob('job-10', {
      kind: 'voice-generate',
      modId: 1,
      params: {},
    });
    const deps = makeDeps({ getActiveJobs: async () => [job] });
    await expect(recoverOrphanedLlmJobs(deps)).resolves.toBe(0);
    expect(job.moveToFailed).not.toHaveBeenCalled();
    expect(deps.enqueueJob).not.toHaveBeenCalled();
  });
});

describe('requeueStalledLlmJob', () => {
  it('detects the BullMQ stall failure text', () => {
    expect(isLlmStallFailure(new Error('job stalled more than allowable limit'))).toBe(true);
    expect(isLlmStallFailure(new Error('cancelled by user'))).toBe(false);
  });

  it('re-enqueues a stalled translate when none is already queued', async () => {
    const job = makeJob('job-1108', translateData());
    const deps = makeDeps();
    await expect(
      requeueStalledLlmJob(job, new Error('job stalled more than allowable limit'), deps),
    ).resolves.toBe(1110);
    expect(deps.enqueueJob).toHaveBeenCalledWith(translateData(), 1110);
  });

  it('does not requeue a stalled job whose snapshot is already cancelled', async () => {
    const job = makeJob('job-1106', translateData());
    const deps = makeDeps({
      readSnapshot: jest.fn(
        async (): Promise<JobSnapshot> => ({
          jobId: 1106,
          kind: 'llm-translate',
          modId: 120,
          status: 'cancelled',
          done: 1,
          total: 2,
          error: null,
          data: {},
        }),
      ),
    });
    await expect(
      requeueStalledLlmJob(job, new Error('job stalled more than allowable limit'), deps),
    ).resolves.toBeNull();
    expect(deps.enqueueJob).not.toHaveBeenCalled();
  });
});

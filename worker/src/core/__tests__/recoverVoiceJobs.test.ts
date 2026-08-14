import { describe, expect, it, jest } from '@jest/globals';
import type { Job } from 'bullmq';
import type { JobData, JobSnapshot } from '../../types';
import {
  isVoiceStallFailure,
  recoverOrphanedVoiceGenerateJobs,
  requeueStalledVoiceGenerate,
  type RecoverVoiceJobsDeps,
} from '../recoverVoiceJobs';

const voiceData = (modId = 33): JobData => ({
  kind: 'voice-generate',
  modId,
  params: { srcLang: 'en', targetLang: 'uk', scope: 'missing' },
});

const makeJob = (id: string, data: JobData): Job<JobData> =>
  ({
    id,
    data,
    moveToFailed: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
  }) as unknown as Job<JobData>;

const makeDeps = (overrides: Partial<RecoverVoiceJobsDeps> = {}): RecoverVoiceJobsDeps => ({
  allocateJobId: jest.fn(async () => 800),
  enqueueJob: jest.fn(async () => undefined),
  readSnapshot: jest.fn(async () => null),
  writeSnapshot: jest.fn(async () => undefined),
  findUnfinished: jest.fn(async () => null),
  log: { info: jest.fn(), warn: jest.fn() },
  ...overrides,
});

describe('recoverOrphanedVoiceGenerateJobs', () => {
  it('re-enqueues active voice-generate and fails the old running snapshot', async () => {
    const job = makeJob('job-723', voiceData());
    const oldSnap: JobSnapshot = {
      jobId: 723,
      kind: 'voice-generate',
      modId: 33,
      status: 'running',
      done: 40,
      total: 100,
      error: null,
      data: {},
    };
    const deps = makeDeps({
      getActiveJobs: async () => [job],
      readSnapshot: jest.fn(async () => oldSnap),
    });

    await expect(recoverOrphanedVoiceGenerateJobs(deps)).resolves.toBe(1);
    expect(job.moveToFailed).toHaveBeenCalled();
    expect(deps.writeSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 723, status: 'failed', error: 'worker restarted' }),
    );
    expect(deps.enqueueJob).toHaveBeenCalledWith(voiceData(), 800);
    expect(deps.writeSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 800, status: 'running', kind: 'voice-generate' }),
    );
  });

  it('leaves non-voice active jobs alone', async () => {
    const job = makeJob('job-10', { kind: 'llm-translate', modId: 1, params: {} });
    const deps = makeDeps({ getActiveJobs: async () => [job] });
    await expect(recoverOrphanedVoiceGenerateJobs(deps)).resolves.toBe(0);
    expect(job.moveToFailed).not.toHaveBeenCalled();
    expect(deps.enqueueJob).not.toHaveBeenCalled();
  });
});

describe('requeueStalledVoiceGenerate', () => {
  it('detects the BullMQ stall failure text', () => {
    expect(isVoiceStallFailure(new Error('job stalled more than allowable limit'))).toBe(true);
    expect(isVoiceStallFailure(new Error('cancelled by user'))).toBe(false);
  });

  it('re-enqueues a stalled voice job when none is already queued', async () => {
    const job = makeJob('job-724', voiceData());
    const deps = makeDeps();
    await expect(
      requeueStalledVoiceGenerate(job, new Error('job stalled more than allowable limit'), deps),
    ).resolves.toBe(800);
    expect(deps.enqueueJob).toHaveBeenCalledWith(voiceData(), 800);
  });

  it('does not enqueue a second voice job for the same mod', async () => {
    const job = makeJob('job-724', voiceData());
    const deps = makeDeps({
      findUnfinished: jest.fn(async () => makeJob('job-725', voiceData())),
    });
    await expect(
      requeueStalledVoiceGenerate(job, new Error('job stalled more than allowable limit'), deps),
    ).resolves.toBeNull();
    expect(deps.enqueueJob).not.toHaveBeenCalled();
  });
});

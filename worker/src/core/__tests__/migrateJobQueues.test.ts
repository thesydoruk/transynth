import { describe, expect, it, jest } from '@jest/globals';
import type { Job } from 'bullmq';
import type { JobData } from '../../types';
import { JOBS_QUEUE_NAME, LLM_QUEUE_NAME, VOICE_QUEUE_NAME } from '../queueNames';
import { migrateJobsToDedicatedQueues } from '../migrateJobQueues';

const makeJob = (id: string, data: JobData, queueName: string): Job<JobData> =>
  ({
    id,
    data,
    queueName,
    moveToFailed: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
  }) as unknown as Job<JobData>;

describe('migrateJobsToDedicatedQueues', () => {
  it('moves leftover LLM and voice jobs off the general queue', async () => {
    const voice = makeJob(
      'job-1',
      { kind: 'voice-generate', modId: 1, params: {} },
      JOBS_QUEUE_NAME,
    );
    const llm = makeJob('job-2', { kind: 'llm-translate', modId: 2, params: {} }, JOBS_QUEUE_NAME);
    const tm = makeJob('job-3', { kind: 'tm-apply', modId: 3, params: {} }, JOBS_QUEUE_NAME);
    const enqueueOnQueue = jest.fn(
      async (_queue: string, _data: JobData, _jobId: number) => undefined,
    );
    const dropJob = jest.fn(async (_job: Job<JobData>) => undefined);

    await expect(
      migrateJobsToDedicatedQueues({
        listUnfinished: async () => [voice, llm, tm],
        enqueueOnQueue,
        dropJob,
        log: { info: jest.fn(), warn: jest.fn() },
      }),
    ).resolves.toBe(2);

    expect(enqueueOnQueue).toHaveBeenCalledWith(VOICE_QUEUE_NAME, voice.data, 1);
    expect(enqueueOnQueue).toHaveBeenCalledWith(LLM_QUEUE_NAME, llm.data, 2);
    expect(enqueueOnQueue).not.toHaveBeenCalledWith(JOBS_QUEUE_NAME, tm.data, 3);
    expect(dropJob).toHaveBeenCalledTimes(2);
  });

  it('leaves jobs that already sit on the correct queue', async () => {
    const enqueueOnQueue = jest.fn(
      async (_queue: string, _data: JobData, _jobId: number) => undefined,
    );
    await expect(
      migrateJobsToDedicatedQueues({
        listUnfinished: async () => [
          makeJob('job-4', { kind: 'voice-generate', modId: 1, params: {} }, VOICE_QUEUE_NAME),
          makeJob('job-5', { kind: 'llm-verify', modId: 1, params: {} }, LLM_QUEUE_NAME),
        ],
        enqueueOnQueue,
        dropJob: jest.fn(async () => undefined),
        log: { info: jest.fn(), warn: jest.fn() },
      }),
    ).resolves.toBe(0);
    expect(enqueueOnQueue).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, jest } from '@jest/globals';
import type { Tx } from '../../../../../src/db';
import type { ModImportJob } from '../../../../../src/import/mod/types';
import { importOrAwait } from '../importJob';

const db = {} as Tx;
const job = (patch: Partial<ModImportJob>): ModImportJob =>
  ({ id: 7, status: 'pending', mod_id: null, ...patch }) as ModImportJob;
const done = job({ status: 'completed', mod_id: 42 });

describe('importOrAwait', () => {
  it('imports a job nobody is running', async () => {
    const run = jest.fn(async () => done);
    const onStart = jest.fn();

    const result = await importOrAwait(db, 7, {
      get: async () => job({}),
      run,
      isRunning: () => false,
      onStart,
    });

    expect(result).toBe(done);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('waits for the run that is importing the job and takes its result', async () => {
    let polls = 0;
    const run = jest.fn(async () => done);
    const sleep = jest.fn(async () => {
      polls += 1;
    });

    const result = await importOrAwait(db, 7, {
      get: async () => done,
      run,
      // The other machine's run holds the job for two polls.
      isRunning: () => polls < 2,
      sleep,
    });

    expect(result).toBe(done);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(run).not.toHaveBeenCalled();
  });

  it('waits again when another run takes the job first', async () => {
    let state: 'free' | 'taken' | 'done' = 'free';
    const run = jest.fn(async () => {
      state = 'taken';
      throw new Error('Mod Import #7 is already running');
    });

    const result = await importOrAwait(db, 7, {
      get: async () => (state === 'done' ? done : job({})),
      run,
      isRunning: () => state === 'taken',
      sleep: async () => {
        state = 'done';
      },
    });

    expect(result).toBe(done);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('passes on any other failure, and answers null for a job that is gone', async () => {
    await expect(
      importOrAwait(db, 7, {
        get: async () => job({}),
        run: async () => {
          throw new Error('Import anchor file not found');
        },
        isRunning: () => false,
      }),
    ).rejects.toThrow('anchor file not found');

    expect(
      await importOrAwait(db, 7, { get: async () => undefined, isRunning: () => false }),
    ).toBeNull();
  });
});

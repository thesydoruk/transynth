import { AsyncLocalStorage } from 'node:async_hooks';
import type { Tx } from '../db';
import type { DependencyService } from './errors';

export type JobRuntime = {
  db: Tx;
  jobId: number;
  kind: string;
  modId: number | null;
  emit: (event: { type: string } & Record<string, unknown>) => void;
  mergeSnapshot: (data: Record<string, unknown>) => void;
  signal: AbortSignal;
  waitTimeoutMs: number;
  healthIntervalMs: number;
  inflightWaits: Map<DependencyService, Promise<void>>;
};

const storage = new AsyncLocalStorage<JobRuntime>();

/** Bind job context for the duration of a handler (health wait + system log). */
export const runWithJobRuntime = <T>(runtime: JobRuntime, fn: () => Promise<T>): Promise<T> =>
  storage.run(runtime, fn);

export const getJobRuntime = (): JobRuntime | undefined => storage.getStore();

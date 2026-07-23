export type TmApplyJobSnapshot = {
  jobId: number;
  modId: number;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  done: number;
  total: number;
  applied: number;
  skipped: number;
  error: string | null;
};

export type TmApplyStreamEvent =
  | { type: 'started'; jobId: number; total: number }
  | { type: 'progress'; done: number; total: number; applied: number }
  | {
      type: 'done';
      done: number;
      total: number;
      applied: number;
      skipped: number;
    }
  | { type: 'cancelled'; done: number; total: number; applied: number; skipped: number }
  | { type: 'error'; error: string };

export type ClearSameAsSourceResult = { cleared: number };

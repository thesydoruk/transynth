import type { LlmNarratorGenderResult } from '../../../../src/llm/narratorGenderDetect';

export type LlmGenderDetectJobStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export type LlmGenderDetectJobSnapshot = {
  jobId: number;
  modId: number;
  status: LlmGenderDetectJobStatus;
  done: number;
  total: number;
  resolvedCount: number;
  error: string | null;
};

export type LlmGenderDetectProgressEvent =
  | { type: 'started'; jobId: number; total: number }
  | { type: 'progress'; done: number; total: number; resolvedBatch?: LlmNarratorGenderResult[] }
  | {
      type: 'done';
      done: number;
      total: number;
      resolvedCount: number;
    }
  | {
      type: 'cancelled';
      done: number;
      total: number;
      resolvedCount: number;
    }
  | { type: 'error'; error: string };

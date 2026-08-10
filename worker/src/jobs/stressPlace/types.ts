import type { ModStressPlaceScope } from '../../../../src/web/data/queries/stressPlacement';

export type LlmStressPlaceJobStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export type LlmStressPlaceJobSnapshot = {
  jobId: number;
  modId: number;
  status: LlmStressPlaceJobStatus;
  done: number;
  total: number;
  placedCount: number;
  error: string | null;
};

export type LlmStressPlaceProgressEvent =
  | { type: 'started'; jobId: number; total: number }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; done: number; total: number; placedCount: number }
  | { type: 'cancelled'; done: number; total: number; placedCount: number }
  | { type: 'error'; error: string };

export type StressPlaceJobParams = {
  srcLang: string;
  targetLang: string;
  scope?: ModStressPlaceScope;
  speakerKey?: string;
  force?: boolean;
};

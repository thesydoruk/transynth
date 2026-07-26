/**
 * Detect strings that should be skipped (proper names, codes, …).
 *
 * Accumulates `candidates` into the snapshot for modal reconnect; supports
 * both single-candidate and batch progress events from the service.
 */
import {
  runLlmSkipDetectJob,
  type LlmSkipDetectCandidate,
  type LlmSkipDetectJobSnapshot,
  type LlmSkipDetectProgressEvent,
} from './index';
import type { JobHandler } from '../../types';
import { runTrackedJob } from '../../runTrackedJob';

export type SkipDetectJobParams = {
  srcLang: string;
  modName?: string | null;
  game?: string | null;
  useLlm?: boolean;
  persist?: boolean;
  force?: boolean;
};

export const skipDetectHandler: JobHandler = (db, ctx) => {
  const params = ctx.data.params as SkipDetectJobParams;
  const modId = ctx.data.modId!;
  const candidates: LlmSkipDetectCandidate[] = [];
  return runTrackedJob<LlmSkipDetectProgressEvent, LlmSkipDetectJobSnapshot>(
    ctx,
    (onEvent) =>
      runLlmSkipDetectJob(
        db,
        {
          jobId: ctx.jobId,
          modId,
          ...params,
          signal: ctx.signal,
          isCancelled: ctx.isCancelled,
        },
        onEvent,
      ),
    (event) => {
      if (event.type === 'progress') {
        if (event.candidatesBatch?.length) candidates.push(...event.candidatesBatch);
        if (event.candidate) candidates.push(event.candidate);
        ctx.mergeSnapshot({ candidates, done: event.done, total: event.total });
      } else if (event.type === 'started') {
        ctx.mergeSnapshot({ candidates: [], markedCount: 0, done: 0, total: event.total });
      }
    },
  );
};

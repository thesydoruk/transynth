/**
 * LLM string translation for a mod.
 *
 * Accumulates translated `rows` into the Redis snapshot so a reopened modal
 * can show recent results without replaying the full SSE stream. The live
 * stream still gets every event via `runTrackedJob`.
 */
import {
  runLlmTranslateJob,
  type LlmTranslateJobSnapshot,
  type LlmTranslateProgressEvent,
  type LlmTranslateRow,
} from './runJob';
import { CONFIG } from '../../../../src/config';
import { pushCapped, trimCappedArray } from '../../core/cappedArray';
import type { JobHandler } from '../../types';
import { runTrackedJob } from '../../runTrackedJob';

export type LlmTranslateJobParams = {
  srcLang: string;
  targetLang: string;
  modName?: string | null;
  game?: string | null;
};

export const llmTranslateHandler: JobHandler = (db, ctx) => {
  const params = ctx.data.params as LlmTranslateJobParams;
  const modId = ctx.data.modId!;
  const rows: LlmTranslateRow[] = [];
  return runTrackedJob<LlmTranslateProgressEvent, LlmTranslateJobSnapshot>(
    ctx,
    (onEvent) =>
      runLlmTranslateJob(
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
      if (event.type === 'progress' && event.row) {
        pushCapped(rows, event.row, CONFIG.jobSnapshotMaxRows);
        ctx.mergeSnapshot({ rows, done: event.done, total: event.total });
      } else if (event.type === 'started') {
        rows.length = 0;
        ctx.mergeSnapshot({ rows: [], done: 0, total: event.total });
      } else if (event.type === 'done' || event.type === 'cancelled') {
        trimCappedArray(rows, CONFIG.jobSnapshotMaxRows);
        ctx.mergeSnapshot({ rows, done: event.done, total: event.total });
      }
    },
  );
};

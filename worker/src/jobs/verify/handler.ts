/**
 * LLM translation verify / auto-approve / fix for a mod.
 *
 * Keeps `issues` and `actionLog` in the Redis snapshot so the verify modal
 * can restore mid-run results after a reconnect (capped by snapshot max rows).
 */
import {
  runLlmVerifyJob,
  type LlmVerifyActionLogEntry,
  type LlmVerifyIssue,
  type LlmVerifyJobSnapshot,
  type LlmVerifyProgressEvent,
} from './index';
import { CONFIG } from '../../../../src/config';
import { pushCapped, trimCappedArray } from '../../core/cappedArray';
import type { JobHandler } from '../../types';
import { runTrackedJob } from '../../runTrackedJob';

export type LlmVerifyJobParams = {
  srcLang: string;
  targetLang: string;
  modName?: string | null;
  game?: string | null;
  autoApproveVerified?: boolean;
  fixSuspicious?: boolean;
  includeConfirmed?: boolean;
};

export const llmVerifyHandler: JobHandler = (db, ctx) => {
  const params = ctx.data.params as LlmVerifyJobParams;
  const modId = ctx.data.modId!;
  const issues: LlmVerifyIssue[] = [];
  const actionLog: LlmVerifyActionLogEntry[] = [];
  return runTrackedJob<LlmVerifyProgressEvent, LlmVerifyJobSnapshot>(
    ctx,
    (onEvent) =>
      runLlmVerifyJob(
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
        if (event.issue) pushCapped(issues, event.issue, CONFIG.jobSnapshotMaxRows);
        if (event.action) pushCapped(actionLog, event.action, CONFIG.jobSnapshotMaxRows);
        ctx.mergeSnapshot({
          issues,
          actionLog,
          done: event.done,
          total: event.total,
          approved: event.approved,
          fixed: event.fixed,
        });
      } else if (event.type === 'started') {
        issues.length = 0;
        actionLog.length = 0;
        ctx.mergeSnapshot({ issues: [], actionLog: [], approved: 0, fixed: 0 });
      } else if (event.type === 'done' || event.type === 'cancelled') {
        trimCappedArray(issues, CONFIG.jobSnapshotMaxRows);
        trimCappedArray(actionLog, CONFIG.jobSnapshotMaxRows);
        ctx.mergeSnapshot({
          issues,
          actionLog,
          done: event.done,
          total: event.total,
          approved: event.approved,
          fixed: event.fixed,
        });
      }
    },
  );
};

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
        if (event.issue) issues.push(event.issue);
        if (event.action) actionLog.push(event.action);
        ctx.mergeSnapshot({
          issues,
          actionLog,
          done: event.done,
          total: event.total,
          approved: event.approved,
          fixed: event.fixed,
        });
      } else if (event.type === 'started') {
        ctx.mergeSnapshot({ issues: [], actionLog: [], approved: 0, fixed: 0 });
      }
    },
  );
};

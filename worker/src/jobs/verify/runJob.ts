/**
 * LLM translation verification job body (runs inside the worker).
 */
import type { Tx } from '../../../../src/db';
import { CONFIG } from '../../../../src/config';
import { logVerify } from '../../../../src/logging/loggers';
import { pushCapped, trimCappedArray } from '../../core/cappedArray';
import { runModVerifyPipeline } from './pipeline/runPipeline';
import { countVerifiableStrings } from './queries';
import type {
  LlmVerifyActionLogEntry,
  LlmVerifyIssue,
  LlmVerifyJobSnapshot,
  LlmVerifyJobStatus,
  LlmVerifyProgressEvent,
} from './types';

export const runLlmVerifyJob = async (
  db: Tx,
  opts: {
    jobId: number;
    modId: number;
    srcLang: string;
    targetLang: string;
    modName?: string | null;
    game?: string | null;
    /** When true, strings passing with no issues are promoted to 'reviewed'. */
    autoApproveVerified?: boolean;
    /** Apply LLM suggestions for suspicious verdicts (incorrect rows are always auto-fixed). */
    fixSuspicious?: boolean;
    /** Include reviewed/human translations in the scan. */
    includeConfirmed?: boolean;
    signal: AbortSignal;
    isCancelled: () => boolean;
  },
  onEvent: (event: LlmVerifyProgressEvent) => void,
): Promise<LlmVerifyJobSnapshot> => {
  const { jobId, modId } = opts;
  const autoApproveVerified = opts.autoApproveVerified === true;
  const fixSuspicious = opts.fixSuspicious === true;
  const includeConfirmed = opts.includeConfirmed === true;

  let done = 0;
  let total = 0;
  let approved = 0;
  let fixed = 0;
  let issueCount = 0;
  const issues: LlmVerifyIssue[] = [];
  const actionLog: LlmVerifyActionLogEntry[] = [];
  let status: LlmVerifyJobStatus = 'running';
  let error: string | null = null;

  const snapshot = (): LlmVerifyJobSnapshot => ({
    jobId,
    modId,
    status,
    done,
    total,
    approved,
    fixed,
    issues,
    actionLog,
    error,
  });

  onEvent({ type: 'started', jobId, total: 0 });

  try {
    total = await countVerifiableStrings(
      db,
      modId,
      opts.srcLang,
      opts.targetLang,
      includeConfirmed,
    );
    if (total === 0) {
      throw new Error('No strings pending review');
    }
    onEvent({ type: 'progress', done: 0, total, approved: 0, fixed: 0 });

    if (opts.isCancelled()) {
      status = 'cancelled';
      onEvent({ type: 'cancelled', done: 0, total, approved: 0, fixed: 0 });
      return snapshot();
    }

    logVerify.info('job started', {
      jobId,
      modId,
      total,
      srcLang: opts.srcLang,
      targetLang: opts.targetLang,
      autoApproveVerified,
      fixSuspicious,
      includeConfirmed,
      llmBatchSize: CONFIG.batchSize,
      dbChunkSize: CONFIG.dbChunkSize,
    });

    const summary = await runModVerifyPipeline(
      db,
      {
        modId,
        srcLang: opts.srcLang,
        targetLang: opts.targetLang,
        modName: opts.modName,
        game: opts.game,
        autoApproveVerified,
        fixSuspicious,
        force: includeConfirmed,
        knownTotal: total,
        shouldCancel: opts.isCancelled,
        signal: opts.signal,
      },
      {
        collectIssue: (issue) => {
          issueCount += 1;
          pushCapped(issues, issue, CONFIG.jobSnapshotMaxRows);
        },
        onActionLog: (entry) => {
          pushCapped(actionLog, entry, CONFIG.jobSnapshotMaxRows);
          onEvent({
            type: 'progress',
            done,
            total,
            approved,
            fixed,
            action: entry,
          });
        },
        onProgress: (progress) => {
          done = progress.done;
          approved = progress.approved;
          fixed = progress.fixed;
          if (progress.issue) {
            onEvent({
              type: 'progress',
              done,
              total,
              approved,
              fixed,
              issue: progress.issue,
            });
          } else if (!autoApproveVerified) {
            onEvent({ type: 'progress', done, total, approved, fixed });
          }
        },
      },
    );

    done = summary.done;
    approved = summary.approved;
    fixed = summary.fixed;

    trimCappedArray(issues, CONFIG.jobSnapshotMaxRows);
    trimCappedArray(actionLog, CONFIG.jobSnapshotMaxRows);

    if (opts.isCancelled()) {
      status = 'cancelled';
      logVerify.info('job cancelled', { jobId, done, total, approved });
      onEvent({ type: 'cancelled', done, total, approved, fixed });
    } else {
      status = 'completed';
      logVerify.info('job completed', {
        jobId,
        done,
        total,
        approved,
        fixed,
        issueCount,
      });
      onEvent({ type: 'done', done, total, approved, fixed });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status = 'failed';
    error = message;
    logVerify.error('job failed', {
      jobId,
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    onEvent({ type: 'error', error: message });
  }

  return snapshot();
};

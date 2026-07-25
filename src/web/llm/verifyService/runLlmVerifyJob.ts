/**
 * In-memory LLM translation verification jobs.
 *
 * Jobs are not persisted — they are lost on worker restart by design.
 */
import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { logVerify } from '../../../logging/loggers';
import { runModVerifyPipeline } from '../verifyPipeline/runModVerifyPipeline';
import { countVerifiableStrings } from './queries';
import {
  allocateVerifyJobId,
  deleteVerifyJob,
  findRunningLlmVerifyJob,
  registerVerifyJob,
  toVerifyJobSnapshot,
} from './jobRegistry';
import type { ActiveLlmVerifyJob, LlmVerifyJobSnapshot, LlmVerifyProgressEvent } from './types';

export const runLlmVerifyJob = async (
  db: Tx,
  opts: {
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
  },
  onEvent: (event: LlmVerifyProgressEvent) => void,
): Promise<LlmVerifyJobSnapshot> => {
  const runningJobId = findRunningLlmVerifyJob(opts.modId);
  if (runningJobId != null) {
    throw new Error(`LLM verify already running for mod ${opts.modId} (job #${runningJobId})`);
  }

  const autoApproveVerified = opts.autoApproveVerified === true;
  const fixSuspicious = opts.fixSuspicious === true;
  const includeConfirmed = opts.includeConfirmed === true;
  const jobId = allocateVerifyJobId();
  const job: ActiveLlmVerifyJob = {
    jobId,
    modId: opts.modId,
    status: 'running',
    done: 0,
    total: 0,
    approved: 0,
    fixed: 0,
    issues: [],
    actionLog: [],
    error: null,
    cancel: false,
    srcLang: opts.srcLang,
    targetLang: opts.targetLang,
    autoApproveVerified,
    fixSuspicious,
    includeConfirmed,
    abort: new AbortController(),
  };
  registerVerifyJob(job);

  // Register early so Stop works during the count / RAG setup phase.
  // Everything after this must be in try/catch so a PG drop during count
  // cannot leave the job stuck as `running` (blocking restart with 409).
  onEvent({ type: 'started', jobId, total: 0 });

  try {
    const total = await countVerifiableStrings(
      db,
      opts.modId,
      opts.srcLang,
      opts.targetLang,
      includeConfirmed,
    );
    if (total === 0) {
      deleteVerifyJob(jobId);
      throw new Error('No strings pending review');
    }
    job.total = total;
    onEvent({ type: 'progress', done: 0, total, approved: 0, fixed: 0 });

    if (job.cancel || job.status === 'cancelled') {
      job.status = 'cancelled';
      onEvent({
        type: 'cancelled',
        done: 0,
        total,
        approved: 0,
        fixed: 0,
        issues: [],
      });
      return toVerifyJobSnapshot(job);
    }

    logVerify.info('job started', {
      jobId,
      modId: opts.modId,
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
        modId: opts.modId,
        srcLang: opts.srcLang,
        targetLang: opts.targetLang,
        modName: opts.modName,
        game: opts.game,
        autoApproveVerified,
        fixSuspicious,
        force: includeConfirmed,
        knownTotal: total,
        shouldCancel: () => job.cancel,
        signal: job.abort.signal,
      },
      {
        collectIssue: (issue) => {
          job.issues.push(issue);
        },
        onActionLog: (entry) => {
          job.actionLog.push(entry);
          onEvent({
            type: 'progress',
            done: job.done,
            total: job.total,
            approved: job.approved,
            fixed: job.fixed,
            action: entry,
          });
        },
        onProgress: (progress) => {
          job.done = progress.done;
          job.approved = progress.approved;
          job.fixed = progress.fixed;
          if (progress.issue) {
            onEvent({
              type: 'progress',
              done: job.done,
              total: job.total,
              approved: job.approved,
              fixed: job.fixed,
              issue: progress.issue,
            });
          } else if (!autoApproveVerified) {
            onEvent({
              type: 'progress',
              done: job.done,
              total: job.total,
              approved: job.approved,
              fixed: job.fixed,
            });
          }
        },
      },
    );

    job.done = summary.done;
    job.approved = summary.approved;
    job.fixed = summary.fixed;

    if (job.cancel || job.status === 'cancelled') {
      if (job.status === 'running') job.status = 'cancelled';
      logVerify.info('job cancelled', {
        jobId,
        done: job.done,
        total: job.total,
        approved: job.approved,
      });
      onEvent({
        type: 'cancelled',
        done: job.done,
        total: job.total,
        approved: job.approved,
        fixed: job.fixed,
        issues: job.issues,
      });
    } else {
      job.status = 'completed';
      logVerify.info('job completed', {
        jobId,
        done: job.done,
        total: job.total,
        approved: job.approved,
        fixed: job.fixed,
        issueCount: job.issues.length,
      });
      onEvent({
        type: 'done',
        done: job.done,
        total: job.total,
        approved: job.approved,
        fixed: job.fixed,
        issues: job.issues,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Mark terminal so restart is allowed. Empty-mod path may already have
    // deleted the map entry; status on the local object still drives the snapshot.
    job.status = 'failed';
    job.error = message;
    logVerify.error('job failed', {
      jobId,
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    onEvent({ type: 'error', error: message });
  }

  return toVerifyJobSnapshot(job);
};

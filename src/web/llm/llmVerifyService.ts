/**
 * In-memory LLM translation verification jobs.
 *
 * Jobs are not persisted — they are lost on worker restart by design.
 */
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import type { LlmVerifyVerdict } from '../../llm/verifyTranslate';
import { llmVerifyEligibleStatusSql } from '../data/queries';
import { logVerify } from '../../logging/loggers';
import { runModVerifyPipeline } from './llmVerifyPipeline';

/** Rows per LLM HTTP request — default 1 so a slow row never blocks siblings in one batch. */
export const LLM_VERIFY_LLM_BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.LLM_VERIFY_BATCH_SIZE || '1', 10),
);

/** Rows fetched from the database per pagination step (see CONFIG.llmVerifyDbChunkSize). */
export const LLM_VERIFY_DB_CHUNK_SIZE = CONFIG.llmVerifyDbChunkSize;

export type LlmVerifyIssue = {
  stringId: number;
  source: string;
  translation: string;
  signature: string | null;
  path: string | null;
  edid: string | null;
  verdict: Exclude<LlmVerifyVerdict, 'ok'>;
  reason: string;
  confidence: number;
  suggestion: string | null;
  /** Set when a fix was attempted but rejected by {@link validateVerifySuggestion}. */
  fixRejected?: string | null;
};

/** One row in the auto-approve action log streamed during verification. */
export type LlmVerifyActionLogEntry = {
  stringId: number;
  edid: string | null;
  path: string | null;
  signature: string | null;
  source: string;
  action: 'approved' | 'fixed' | 'issue';
  detail?: string | null;
};

export type LlmVerifyJobStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export type LlmVerifyJobSnapshot = {
  jobId: number;
  modId: number;
  status: LlmVerifyJobStatus;
  done: number;
  total: number;
  /** Strings auto-confirmed (promoted to 'reviewed') because they passed with no issues. */
  approved: number;
  /** Strings auto-corrected from LLM suggestions (incorrect always; suspicious when enabled). */
  fixed: number;
  issues: LlmVerifyIssue[];
  actionLog: LlmVerifyActionLogEntry[];
  error: string | null;
};

type ActiveLlmVerifyJob = LlmVerifyJobSnapshot & {
  cancel: boolean;
  srcLang: string;
  targetLang: string;
  autoApproveVerified: boolean;
  /** Apply LLM suggestions for suspicious verdicts (incorrect rows are always auto-fixed). */
  fixSuspicious: boolean;
  /** Include reviewed/human rows in the scan (CLI `--force`). */
  includeConfirmed: boolean;
  /** Aborts in-flight LLM requests the instant Stop is pressed. */
  abort: AbortController;
};

const activeJobs = new Map<number, ActiveLlmVerifyJob>();
let nextJobId = 1;

const toSnapshot = (job: ActiveLlmVerifyJob): LlmVerifyJobSnapshot => ({
  jobId: job.jobId,
  modId: job.modId,
  status: job.status,
  done: job.done,
  total: job.total,
  approved: job.approved,
  fixed: job.fixed,
  issues: job.issues,
  actionLog: job.actionLog,
  error: job.error,
});

export const getLlmVerifyJob = (jobId: number): LlmVerifyJobSnapshot | null => {
  const job = activeJobs.get(jobId);
  return job ? toSnapshot(job) : null;
};

export const findRunningLlmVerifyJob = (modId: number): number | null => {
  for (const job of activeJobs.values()) {
    if (job.modId === modId && job.status === 'running') return job.jobId;
  }
  return null;
};

export const requestLlmVerifyStop = (jobId: number): boolean => {
  const job = activeJobs.get(jobId);
  if (!job || job.status !== 'running') return false;
  // Order matters: flag cancel before aborting so the abort error surfaces as a
  // cancellation (and isn't recorded as a job failure).
  job.cancel = true;
  job.abort.abort();
  return true;
};

/** Idempotent stop — returns false only when no running job exists for this mod. */
export const requestLlmVerifyStopByModId = (modId: number): boolean => {
  const jobId = findRunningLlmVerifyJob(modId);
  if (jobId == null) return false;
  return requestLlmVerifyStop(jobId);
};

export const countVerifiableStrings = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
  force = false,
): Promise<number> => {
  const { rows } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $3
      WHERE r.mod_id = $1
        AND s.lang = $2
        AND s.is_ignored = FALSE
        AND t.status IN ${llmVerifyEligibleStatusSql(force)}
        AND length(trim(t.text)) > 0`,
    [modId, srcLang, targetLang],
  );
  return Number.parseInt(rows[0]?.cnt ?? '0', 10);
};

type VerifyStringRow = {
  string_id: number;
  source: string;
  translation: string;
  text_norm: string | null;
  text_norm_nopunct: string | null;
  signature: string | null;
  path: string | null;
  edid: string | null;
  context: string | null;
};

/**
 * Keyset pagination by `s.id` (not OFFSET): when auto-approve promotes rows to
 * 'reviewed' they drop out of this filtered set mid-run, so OFFSET would shift
 * and silently skip rows. Fetching strictly `s.id > afterId` is stable under
 * concurrent status changes and avoids OFFSET scan cost on large mods.
 */
export const loadVerifyChunk = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
  afterId: number,
  limit: number,
  force = false,
): Promise<VerifyStringRow[]> => {
  const { rows } = await db.query<VerifyStringRow>(
    `SELECT s.id AS string_id,
            s.text_raw AS source,
            t.text AS translation,
            s.text_norm,
            s.text_norm_nopunct,
            r.signature,
            r.path,
            r.edid,
            s.context
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $3
      WHERE r.mod_id = $1
        AND s.lang = $2
        AND s.is_ignored = FALSE
        AND t.status IN ${llmVerifyEligibleStatusSql(force)}
        AND length(trim(t.text)) > 0
        AND s.id > $5
      ORDER BY s.id
      LIMIT $4`,
    [modId, srcLang, targetLang, limit, afterId],
  );
  return rows;
};

export type VerifyLlmWorkUnit = {
  page: number;
  chunk: VerifyStringRow[];
};

/** Stream LLM work units from the DB — prefetches the next page while workers drain the current one. */
export async function* iterateVerifyLlmChunks(
  db: Tx,
  opts: {
    modId: number;
    srcLang: string;
    targetLang: string;
    dbChunkSize?: number;
    force?: boolean;
  },
): AsyncGenerator<VerifyLlmWorkUnit> {
  let afterStringId = 0;
  let page = 0;
  const dbChunkSize = Math.max(50, opts.dbChunkSize ?? LLM_VERIFY_DB_CHUNK_SIZE);
  const force = opts.force === true;

  let nextPagePromise: Promise<VerifyStringRow[]> = loadVerifyChunk(
    db,
    opts.modId,
    opts.srcLang,
    opts.targetLang,
    afterStringId,
    dbChunkSize,
    force,
  );

  while (nextPagePromise) {
    const dbChunk = await nextPagePromise;
    if (dbChunk.length === 0) break;

    const lastId = dbChunk[dbChunk.length - 1]!.string_id;
    page++;
    afterStringId = lastId;

    nextPagePromise =
      dbChunk.length >= dbChunkSize
        ? loadVerifyChunk(db, opts.modId, opts.srcLang, opts.targetLang, lastId, dbChunkSize, force)
        : Promise.resolve([]);

    for (let i = 0; i < dbChunk.length; i += LLM_VERIFY_LLM_BATCH_SIZE) {
      yield { page, chunk: dbChunk.slice(i, i + LLM_VERIFY_LLM_BATCH_SIZE) };
    }
  }
}

export type LlmVerifyProgressEvent =
  | { type: 'started'; jobId: number; total: number }
  | {
      type: 'progress';
      done: number;
      total: number;
      approved: number;
      fixed: number;
      issue?: LlmVerifyIssue;
      action?: LlmVerifyActionLogEntry;
    }
  | {
      type: 'done';
      done: number;
      total: number;
      approved: number;
      fixed: number;
      issues: LlmVerifyIssue[];
    }
  | {
      type: 'cancelled';
      done: number;
      total: number;
      approved: number;
      fixed: number;
      issues: LlmVerifyIssue[];
    }
  | { type: 'error'; error: string };

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
  const jobId = nextJobId++;
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
  activeJobs.set(jobId, job);

  // Register early so Stop works during the count / RAG setup phase.
  onEvent({ type: 'started', jobId, total: 0 });

  const total = await countVerifiableStrings(
    db,
    opts.modId,
    opts.srcLang,
    opts.targetLang,
    includeConfirmed,
  );
  if (total === 0) {
    activeJobs.delete(jobId);
    throw new Error('No strings pending review');
  }
  job.total = total;
  onEvent({ type: 'progress', done: 0, total, approved: 0, fixed: 0 });

  if (job.cancel) {
    job.status = 'cancelled';
    onEvent({
      type: 'cancelled',
      done: 0,
      total,
      approved: 0,
      fixed: 0,
      issues: [],
    });
    return toSnapshot(job);
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
    llmBatchSize: LLM_VERIFY_LLM_BATCH_SIZE,
    dbChunkSize: CONFIG.llmVerifyDbChunkSize,
  });

  try {
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

    if (job.cancel) {
      job.status = 'cancelled';
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
    job.status = 'failed';
    job.error = message;
    logVerify.error('job failed', {
      jobId,
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    onEvent({ type: 'error', error: message });
  }

  return toSnapshot(job);
};

/** Remove finished jobs from memory after a delay to allow status polling. */
export const scheduleLlmVerifyJobCleanup = (jobId: number, delayMs = 60_000): void => {
  setTimeout(() => {
    const job = activeJobs.get(jobId);
    if (job && job.status !== 'running') {
      activeJobs.delete(jobId);
    }
  }, delayMs);
};

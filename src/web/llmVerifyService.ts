/**
 * In-memory LLM translation verification jobs.
 *
 * Jobs are not persisted — they are lost on worker restart by design.
 */
import type { Tx } from '../db';
import { CONFIG, getTranslateModel } from '../config';
import {
  verifyTranslationsWithLlm,
  type LlmVerifyItem,
  type LlmVerifyVerdict,
} from '../llm/verifyTranslate';
import { clampRagMaxExamples } from '../llm/ragConstants';
import { fetchReferenceExamplesBatch, requirePgvectorForRag } from '../llm/ragService';
import { getAllProjectSettings } from './projectSettings';
import {
  approveVerifiedTranslations,
  PENDING_REVIEW_STATUS_SQL,
  LLM_PROTECTED_TRANSLATION_STATUS_SQL,
} from './queries';
import { parseRecordLocation } from '../utils/recordLocation';
import { mapWithConcurrency } from '../utils/concurrency';
import { logVerify } from '../logging/loggers';

/** Rows sent to the LLM per request (smaller than translate batches for steadier progress). */
export const LLM_VERIFY_LLM_BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.LLM_VERIFY_BATCH_SIZE || '10', 10),
);

/** Rows fetched from the database per pagination step. */
export const LLM_VERIFY_DB_CHUNK_SIZE = 100;

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
  issues: LlmVerifyIssue[];
  error: string | null;
};

type ActiveLlmVerifyJob = LlmVerifyJobSnapshot & {
  cancel: boolean;
  srcLang: string;
  targetLang: string;
  autoApproveVerified: boolean;
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
  issues: job.issues,
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
): Promise<number> => {
  const { rows } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $3
      WHERE r.mod_id = $1
        AND s.lang = $2
        AND s.is_ignored = FALSE
        AND t.status IN ${PENDING_REVIEW_STATUS_SQL}
        AND t.status NOT IN ${LLM_PROTECTED_TRANSLATION_STATUS_SQL}
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
        AND t.status IN ${PENDING_REVIEW_STATUS_SQL}
        AND t.status NOT IN ${LLM_PROTECTED_TRANSLATION_STATUS_SQL}
        AND length(trim(t.text)) > 0
        AND s.id > $5
      ORDER BY s.id
      LIMIT $4`,
    [modId, srcLang, targetLang, limit, afterId],
  );
  return rows;
};

export type LlmVerifyProgressEvent =
  | { type: 'started'; jobId: number; total: number }
  | { type: 'progress'; done: number; total: number; approved: number; issue?: LlmVerifyIssue }
  | { type: 'done'; done: number; total: number; approved: number; issues: LlmVerifyIssue[] }
  | { type: 'cancelled'; done: number; total: number; approved: number; issues: LlmVerifyIssue[] }
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
  },
  onEvent: (event: LlmVerifyProgressEvent) => void,
): Promise<LlmVerifyJobSnapshot> => {
  const runningJobId = findRunningLlmVerifyJob(opts.modId);
  if (runningJobId != null) {
    throw new Error(`LLM verify already running for mod ${opts.modId} (job #${runningJobId})`);
  }

  const autoApproveVerified = opts.autoApproveVerified === true;
  const jobId = nextJobId++;
  const job: ActiveLlmVerifyJob = {
    jobId,
    modId: opts.modId,
    status: 'running',
    done: 0,
    total: 0,
    approved: 0,
    issues: [],
    error: null,
    cancel: false,
    srcLang: opts.srcLang,
    targetLang: opts.targetLang,
    autoApproveVerified,
    abort: new AbortController(),
  };
  activeJobs.set(jobId, job);

  // Register early so Stop works during the count / RAG setup phase.
  onEvent({ type: 'started', jobId, total: 0 });

  const total = await countVerifiableStrings(db, opts.modId, opts.srcLang, opts.targetLang);
  if (total === 0) {
    activeJobs.delete(jobId);
    throw new Error('No strings pending review');
  }
  job.total = total;
  onEvent({ type: 'progress', done: 0, total, approved: 0 });

  if (job.cancel) {
    job.status = 'cancelled';
    onEvent({
      type: 'cancelled',
      done: 0,
      total,
      approved: 0,
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
    llmBatchSize: LLM_VERIFY_LLM_BATCH_SIZE,
  });

  await requirePgvectorForRag(db);

  if (job.cancel) {
    job.status = 'cancelled';
    onEvent({
      type: 'cancelled',
      done: job.done,
      total: job.total,
      approved: job.approved,
      issues: job.issues,
    });
    return toSnapshot(job);
  }

  const projectSettings = await getAllProjectSettings(db);
  const ragMaxExamples = clampRagMaxExamples(projectSettings['llm.rag_max_examples']);
  const ragMinSimilarity = Math.min(1, Math.max(0, projectSettings['llm.rag_min_similarity']));

  const model = getTranslateModel();

  // The LLM chat semaphore (CONFIG.llmMaxParallel) is the real concurrency cap on
  // outgoing requests; we oversubscribe the batch pool by embedMaxParallel so the
  // chat slots stay saturated even while some workers are blocked on RAG embedding
  // or DB writes (RAG → chat → approve run serially within a single batch worker).
  const batchConcurrency = CONFIG.llmMaxParallel + CONFIG.embedMaxParallel;

  let firstError: string | null = null;

  /** Run one LLM verify batch end-to-end (RAG → verify → record results / auto-approve). */
  const processLlmBatch = async (llmChunk: VerifyStringRow[]): Promise<void> => {
    if (job.cancel || firstError) return;

    const rowById = new Map(llmChunk.map((row) => [row.string_id, row]));

    const ragByStringId = await fetchReferenceExamplesBatch(
      db,
      llmChunk.map((row) => {
        const { grup } = parseRecordLocation(row.signature, row.path);
        return {
          stringId: row.string_id,
          sourceText: row.source,
          textNorm: row.text_norm,
          textNormNopunct: row.text_norm_nopunct,
          signature: grup,
          path: row.path,
          context: row.context,
        };
      }),
      opts.srcLang,
      opts.targetLang,
      ragMaxExamples,
      ragMinSimilarity,
    );

    if (job.cancel || firstError) return;

    const items: LlmVerifyItem[] = llmChunk.map((row) => {
      const { grup, field } = parseRecordLocation(row.signature, row.path);
      return {
        id: row.string_id,
        source: row.source,
        translation: row.translation,
        grup,
        edid: row.edid,
        field,
        context: row.context,
        reference_examples: ragByStringId.get(row.string_id),
      };
    });

    let results: Awaited<ReturnType<typeof verifyTranslationsWithLlm>>;
    try {
      results = await verifyTranslationsWithLlm({
        items,
        model,
        srcLang: opts.srcLang,
        targetLang: opts.targetLang,
        game: opts.game,
        modName: opts.modName,
        signal: job.abort.signal,
      });
    } catch (err) {
      // A stopped job aborts the in-flight request: treat as cancellation, not failure.
      if (job.cancel) return;
      const message = err instanceof Error ? err.message : String(err);
      logVerify.error('job chunk failed', {
        jobId,
        modId: opts.modId,
        error: message,
      });
      // Stop scheduling further batches; in-flight ones drain on their own.
      if (!firstError) firstError = message;
      job.cancel = true;
      for (const _row of llmChunk) {
        job.done++;
        onEvent({ type: 'progress', done: job.done, total: job.total, approved: job.approved });
      }
      return;
    }

    const okStringIds: number[] = [];
    for (const result of results) {
      job.done++;
      if (result.verdict === 'ok') {
        okStringIds.push(result.id);
        onEvent({ type: 'progress', done: job.done, total: job.total, approved: job.approved });
        continue;
      }

      const row = rowById.get(result.id);
      if (!row) continue;

      const issue: LlmVerifyIssue = {
        stringId: result.id,
        source: row.source,
        translation: row.translation,
        signature: row.signature,
        path: row.path,
        edid: row.edid,
        verdict: result.verdict,
        reason: result.reason,
        confidence: result.confidence,
        suggestion: result.suggestion,
      };
      job.issues.push(issue);
      onEvent({
        type: 'progress',
        done: job.done,
        total: job.total,
        approved: job.approved,
        issue,
      });
    }

    if (job.autoApproveVerified && okStringIds.length > 0) {
      try {
        const promoted = await approveVerifiedTranslations(db, okStringIds, opts.targetLang);
        job.approved += promoted;
        onEvent({ type: 'progress', done: job.done, total: job.total, approved: job.approved });
      } catch (approveErr) {
        logVerify.warn('auto-approve failed for chunk', {
          jobId,
          modId: opts.modId,
          error: approveErr instanceof Error ? approveErr.message : String(approveErr),
        });
      }
    }
  };

  let afterId = 0;

  try {
    while (!job.cancel && !firstError) {
      const dbChunk = await loadVerifyChunk(
        db,
        opts.modId,
        opts.srcLang,
        opts.targetLang,
        afterId,
        LLM_VERIFY_DB_CHUNK_SIZE,
      );
      if (dbChunk.length === 0) break;
      afterId = dbChunk[dbChunk.length - 1]!.string_id;

      const llmChunks: VerifyStringRow[][] = [];
      for (let i = 0; i < dbChunk.length; i += LLM_VERIFY_LLM_BATCH_SIZE) {
        llmChunks.push(dbChunk.slice(i, i + LLM_VERIFY_LLM_BATCH_SIZE));
      }

      // Batches within a page run concurrently; the LLM/embed semaphores cap the
      // actual in-flight HTTP requests. Stop/error is honored before each batch.
      await mapWithConcurrency(llmChunks, batchConcurrency, processLlmBatch);
    }

    if (firstError) {
      job.status = 'failed';
      job.error = firstError;
      onEvent({ type: 'error', error: firstError });
      return toSnapshot(job);
    }

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
        issues: job.issues,
      });
    } else {
      job.status = 'completed';
      logVerify.info('job completed', {
        jobId,
        done: job.done,
        total: job.total,
        approved: job.approved,
        issueCount: job.issues.length,
      });
      onEvent({
        type: 'done',
        done: job.done,
        total: job.total,
        approved: job.approved,
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

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
import { filterVerifyReferenceExamples } from '../llm/verifyReferenceExamples';
import { canApproveAppliedFix, resolveVerifyFixAction } from '../llm/verifySuggestionGuards';
import { clampRagMaxExamples } from '../llm/ragConstants';
import { fetchReferenceExamplesBatch, requirePgvectorForRag } from '../llm/ragService';
import { getAllProjectSettings } from './projectSettings';
import {
  approveVerifiedTranslations,
  upsertTranslation,
  llmVerifyEligibleStatusSql,
} from './queries';
import { parseRecordLocation } from '../utils/recordLocation';
import { runPoolOverAsyncIterable } from '../utils/concurrency';
import { runLlmChunkWithRecovery } from '../llm/chunkRecovery';
import { withRequestDeadline } from '../llm/requestDeadline';
import { llmChatPipelineConcurrency } from '../llm/requestPool';
import { logVerify } from '../logging/loggers';
import { loadGlossaryEntries, relevantGlossaryEntries } from './glossaryForLlm';

/** Rows per LLM HTTP request — default 1 so a slow row never blocks siblings in one batch. */
export const LLM_VERIFY_LLM_BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.LLM_VERIFY_BATCH_SIZE || '1', 10),
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

/** Stream LLM work units from the DB — no page barrier; workers pull as they free up. */
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

  while (true) {
    const dbChunk = await loadVerifyChunk(
      db,
      opts.modId,
      opts.srcLang,
      opts.targetLang,
      afterStringId,
      dbChunkSize,
      force,
    );
    if (dbChunk.length === 0) break;
    afterStringId = dbChunk[dbChunk.length - 1]!.string_id;
    page++;

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
  });

  await requirePgvectorForRag(db);

  const glossaryAll = await loadGlossaryEntries(db, opts.srcLang, opts.targetLang);

  if (job.cancel) {
    job.status = 'cancelled';
    onEvent({
      type: 'cancelled',
      done: job.done,
      total: job.total,
      approved: job.approved,
      fixed: job.fixed,
      issues: job.issues,
    });
    return toSnapshot(job);
  }

  const projectSettings = await getAllProjectSettings(db);
  const ragMaxExamples = clampRagMaxExamples(projectSettings['llm.rag_max_examples']);
  const ragMinSimilarity = Math.min(1, Math.max(0, projectSettings['llm.rag_min_similarity']));

  const model = getTranslateModel();

  const chatConcurrency = llmChatPipelineConcurrency();

  const emitProgress = (extra?: {
    issue?: LlmVerifyIssue;
    action?: LlmVerifyActionLogEntry;
  }): void => {
    if (extra?.action) {
      job.actionLog.push(extra.action);
    }
    onEvent({
      type: 'progress',
      done: job.done,
      total: job.total,
      approved: job.approved,
      fixed: job.fixed,
      ...extra,
    });
  };

  type RagByStringId = Awaited<ReturnType<typeof fetchReferenceExamplesBatch>>;

  const fetchChunkRag = async (llmChunk: VerifyStringRow[]): Promise<RagByStringId> => {
    if (job.cancel || llmChunk.length === 0) return new Map();
    try {
      return await fetchReferenceExamplesBatch(
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
    } catch (err) {
      logVerify.warn('RAG fetch failed for verify chunk; continuing without examples', {
        jobId,
        modId: opts.modId,
        err: err instanceof Error ? err.message : String(err),
        stringIds: llmChunk.map((row) => row.string_id),
      });
      return new Map();
    }
  };

  /** Verify one batch (LLM call + DB updates). Throws on LLM failure for chunk recovery. */
  const processLlmBatchInner = async (
    llmChunk: VerifyStringRow[],
    ragByStringId: RagByStringId,
  ): Promise<void> => {
    if (job.cancel) return;

    const rowById = new Map(llmChunk.map((row) => [row.string_id, row]));

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
        reference_examples: filterVerifyReferenceExamples(ragByStringId.get(row.string_id), {
          grup,
          field,
          source: row.source,
        }),
      };
    });

    const results = await withRequestDeadline(
      CONFIG.llmVerifyRequestTimeoutMs,
      job.abort.signal,
      (signal) =>
        verifyTranslationsWithLlm({
          items,
          model,
          srcLang: opts.srcLang,
          targetLang: opts.targetLang,
          game: opts.game,
          modName: opts.modName,
          glossary: relevantGlossaryEntries(
            glossaryAll,
            llmChunk.map((row) => row.source),
          ),
          signal,
        }),
    );

    const okStringIds: number[] = [];
    const validatedFixedIds: number[] = [];
    const logAction = (
      row: VerifyStringRow,
      action: LlmVerifyActionLogEntry['action'],
      detail?: string | null,
    ) => {
      if (!job.autoApproveVerified) return;
      emitProgress({
        action: {
          stringId: row.string_id,
          edid: row.edid,
          path: row.path,
          signature: row.signature,
          source: row.source,
          action,
          detail: detail ?? null,
        },
      });
    };

    for (const result of results) {
      job.done++;
      const row = rowById.get(result.id);

      if (result.verdict === 'ok') {
        okStringIds.push(result.id);
        emitProgress();
        continue;
      }

      if (!row) continue;

      const itemForValidation: LlmVerifyItem = {
        id: row.string_id,
        source: row.source,
        translation: row.translation,
        grup: parseRecordLocation(row.signature, row.path).grup,
        edid: row.edid,
        field: parseRecordLocation(row.signature, row.path).field,
        context: row.context,
      };

      const fixAction = resolveVerifyFixAction(
        itemForValidation,
        result.verdict,
        result.suggestion,
        job.fixSuspicious,
        opts.game,
      );

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
        suggestion: fixAction.kind === 'apply' ? fixAction.suggestion : result.suggestion,
        fixRejected: fixAction.kind === 'reject_fix' ? fixAction.message : null,
      };

      if (fixAction.kind === 'apply') {
        try {
          await upsertTranslation(db, result.id, fixAction.suggestion, 'auto', opts.targetLang);
          job.fixed++;
          if (canApproveAppliedFix(itemForValidation, fixAction.suggestion, opts.game)) {
            validatedFixedIds.push(result.id);
          }
          logAction(row, 'fixed', fixAction.suggestion);
        } catch (err) {
          logVerify.warn('auto-fix failed for verify row', {
            jobId,
            modId: opts.modId,
            stringId: result.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (fixAction.kind === 'reject_fix') {
        logVerify.warn('auto-fix skipped — suggestion failed validation', {
          jobId,
          modId: opts.modId,
          stringId: result.id,
          reason: fixAction.message,
        });
      }

      job.issues.push(issue);
      if (job.autoApproveVerified) {
        logAction(row, 'issue', result.reason);
      } else {
        emitProgress({ issue });
      }
    }

    if (job.autoApproveVerified && (okStringIds.length > 0 || validatedFixedIds.length > 0)) {
      const toApprove = [...okStringIds, ...validatedFixedIds];
      try {
        const promoted = await approveVerifiedTranslations(db, toApprove, opts.targetLang);
        job.approved += promoted;
        for (const id of okStringIds) {
          const row = rowById.get(id);
          if (row) logAction(row, 'approved');
        }
        for (const id of validatedFixedIds) {
          const row = rowById.get(id);
          if (row) logAction(row, 'approved');
        }
      } catch (approveErr) {
        logVerify.warn('auto-approve failed for chunk', {
          jobId,
          modId: opts.modId,
          error: approveErr instanceof Error ? approveErr.message : String(approveErr),
        });
      }
    }
  };

  const emitChunkFailure = (llmChunk: readonly VerifyStringRow[], message: string): void => {
    logVerify.error('job chunk failed; continuing with next chunk', {
      jobId,
      modId: opts.modId,
      error: message,
      stringIds: llmChunk.map((row) => row.string_id),
    });
    for (const _row of llmChunk) {
      job.done++;
      emitProgress();
    }
  };

  const processLlmChunk = async (llmChunk: VerifyStringRow[]): Promise<void> => {
    if (job.cancel || llmChunk.length === 0) return;
    const ragByStringId = await fetchChunkRag(llmChunk);
    if (job.cancel) return;
    await runLlmChunkWithRecovery({
      chunk: llmChunk,
      shouldAbort: () => job.cancel,
      runOnce: (chunk) => processLlmBatchInner([...chunk], ragByStringId),
      onFailure: (failed, message) => emitChunkFailure(failed, message),
      log: logVerify,
      operation: 'verify',
      itemIds: (chunk) => chunk.map((row) => row.string_id),
    });
  };

  try {
    await runPoolOverAsyncIterable(
      iterateVerifyLlmChunks(db, {
        modId: opts.modId,
        srcLang: opts.srcLang,
        targetLang: opts.targetLang,
        dbChunkSize: LLM_VERIFY_DB_CHUNK_SIZE,
        force: includeConfirmed,
      }),
      chatConcurrency,
      async ({ chunk }) => {
        if (job.cancel) return;
        await processLlmChunk(chunk);
      },
    );

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

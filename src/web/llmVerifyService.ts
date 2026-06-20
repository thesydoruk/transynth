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
import { fetchReferenceExamplesBatch, requirePgvectorForRag } from '../llm/ragService';
import { getAllProjectSettings } from './projectSettings';
import { parseRecordLocation } from '../utils/recordLocation';
import { logVerify } from '../logging/loggers';

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
  issues: LlmVerifyIssue[];
  error: string | null;
};

type ActiveLlmVerifyJob = LlmVerifyJobSnapshot & {
  cancel: boolean;
  srcLang: string;
  targetLang: string;
};

const activeJobs = new Map<number, ActiveLlmVerifyJob>();
let nextJobId = 1;

const toSnapshot = (job: ActiveLlmVerifyJob): LlmVerifyJobSnapshot => ({
  jobId: job.jobId,
  modId: job.modId,
  status: job.status,
  done: job.done,
  total: job.total,
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
  job.cancel = true;
  return true;
};

const countVerifiableStrings = async (
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

const loadVerifyChunk = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
  offset: number,
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
        AND length(trim(t.text)) > 0
      ORDER BY s.id
      LIMIT $4 OFFSET $5`,
    [modId, srcLang, targetLang, limit, offset],
  );
  return rows;
};

export type LlmVerifyProgressEvent =
  | { type: 'started'; jobId: number; total: number }
  | { type: 'progress'; done: number; total: number; issue?: LlmVerifyIssue }
  | { type: 'done'; done: number; total: number; issues: LlmVerifyIssue[] }
  | { type: 'cancelled'; done: number; total: number; issues: LlmVerifyIssue[] }
  | { type: 'error'; error: string };

export const runLlmVerifyJob = async (
  db: Tx,
  opts: {
    modId: number;
    srcLang: string;
    targetLang: string;
    modName?: string | null;
    game?: string | null;
  },
  onEvent: (event: LlmVerifyProgressEvent) => void,
): Promise<LlmVerifyJobSnapshot> => {
  const runningJobId = findRunningLlmVerifyJob(opts.modId);
  if (runningJobId != null) {
    throw new Error(`LLM verify already running for mod ${opts.modId} (job #${runningJobId})`);
  }

  const total = await countVerifiableStrings(db, opts.modId, opts.srcLang, opts.targetLang);
  if (total === 0) {
    throw new Error('No translated strings to verify');
  }

  const jobId = nextJobId++;
  const job: ActiveLlmVerifyJob = {
    jobId,
    modId: opts.modId,
    status: 'running',
    done: 0,
    total,
    issues: [],
    error: null,
    cancel: false,
    srcLang: opts.srcLang,
    targetLang: opts.targetLang,
  };
  activeJobs.set(jobId, job);

  logVerify.info('job started', {
    jobId,
    modId: opts.modId,
    total,
    srcLang: opts.srcLang,
    targetLang: opts.targetLang,
  });

  onEvent({ type: 'started', jobId, total });

  await requirePgvectorForRag(db);

  const projectSettings = await getAllProjectSettings(db);
  const ragMaxExamples = Math.min(10, Math.max(1, projectSettings['llm.rag_max_examples']));
  const ragMinSimilarity = Math.min(1, Math.max(0, projectSettings['llm.rag_min_similarity']));

  const model = getTranslateModel();
  let dbOffset = 0;

  try {
    while (dbOffset < total && !job.cancel) {
      const dbChunk = await loadVerifyChunk(
        db,
        opts.modId,
        opts.srcLang,
        opts.targetLang,
        dbOffset,
        LLM_VERIFY_DB_CHUNK_SIZE,
      );
      if (dbChunk.length === 0) break;
      dbOffset += dbChunk.length;

      for (let i = 0; i < dbChunk.length && !job.cancel; i += CONFIG.batchSize) {
        const llmChunk = dbChunk.slice(i, i + CONFIG.batchSize);
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

        try {
          const results = await verifyTranslationsWithLlm({
            items,
            model,
            srcLang: opts.srcLang,
            targetLang: opts.targetLang,
            game: opts.game,
            modName: opts.modName,
          });

          for (const result of results) {
            job.done++;
            if (result.verdict === 'ok') {
              onEvent({ type: 'progress', done: job.done, total: job.total });
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
            onEvent({ type: 'progress', done: job.done, total: job.total, issue });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logVerify.error('job chunk failed', { err, jobId, modId: opts.modId });
          for (const row of llmChunk) {
            job.done++;
            onEvent({ type: 'progress', done: job.done, total: job.total });
          }
          job.status = 'failed';
          job.error = message;
          onEvent({ type: 'error', error: message });
          return toSnapshot(job);
        }
      }
    }

    if (job.cancel) {
      job.status = 'cancelled';
      logVerify.info('job cancelled', { jobId, done: job.done, total: job.total });
      onEvent({
        type: 'cancelled',
        done: job.done,
        total: job.total,
        issues: job.issues,
      });
    } else {
      job.status = 'completed';
      logVerify.info('job completed', {
        jobId,
        done: job.done,
        total: job.total,
        issueCount: job.issues.length,
      });
      onEvent({
        type: 'done',
        done: job.done,
        total: job.total,
        issues: job.issues,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.status = 'failed';
    job.error = message;
    logVerify.error('job failed', { jobId, error: message, err });
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

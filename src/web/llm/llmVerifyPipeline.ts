/**
 * High-throughput LLM verify pipeline — continuous work queue with DB prefetch
 * and async persist so chat slots stay saturated on the LLM host.
 */
import type { Tx } from '../../db';
import { CONFIG, getTranslateModel } from '../../config';
import { filterVerifyReferenceExamples } from '../../llm/verifyReferenceExamples';
import { resolveVerifyFixAction } from '../../llm/verifySuggestionGuards';
import { rewriteVerifyTranslationsFromSource } from '../../llm/verifySourceRewrite';
import {
  verifyTranslationsWithLlm,
  isLlmVerifyMissingIdsError,
  finalizeVerifyItemResults,
  type LlmVerifyItem,
} from '../../llm/verifyTranslate';
import { clampRagMaxExamples } from '../../llm/ragConstants';
import {
  fetchReferenceExamplesBatch,
  requirePgvectorForRag,
  type RagRetrievalOptions,
} from '../../llm/ragService';
import { getAllProjectSettings } from '../services/projectSettings';
import { approveVerifiedTranslations, upsertTranslation } from '../data/queries';
import { parseRecordLocation } from '../../utils/recordLocation';
import { runLlmChunkWorkPoolFromFeed, enqueueSoloChunks } from '../../llm/chunkRecovery';
import { withRequestDeadline } from '../../llm/requestDeadline';
import { isLlmTimeoutError } from '../../llm/retry';
import { llmChatPipelineConcurrency } from '../../llm/requestPool';
import { logVerify } from '../../logging/loggers';
import { Semaphore } from '../../utils/concurrency';
import { loadGlossaryEntries, relevantGlossaryEntries } from './glossaryForLlm';
import {
  countVerifiableStrings,
  iterateVerifyLlmChunks,
  type LlmVerifyIssue,
  type VerifyLlmWorkUnit,
} from './llmVerifyService';

export type VerifyStringRow = VerifyLlmWorkUnit['chunk'][number];

export type VerifyPipelineProgress = {
  done: number;
  approved: number;
  fixed: number;
  suspicious: number;
  incorrect: number;
  errors: number;
  dbPage: number;
  issue?: LlmVerifyIssue;
  chunkError?: { stringIds: number[]; message: string };
};

export type RunModVerifyPipelineOpts = {
  modId: number;
  srcLang: string;
  targetLang: string;
  modName?: string | null;
  game?: string | null;
  dryRun?: boolean;
  autoApproveVerified?: boolean;
  fixSuspicious?: boolean;
  force?: boolean;
  dbChunkSize?: number;
  rag?: RagRetrievalOptions;
  shouldCancel?: () => boolean;
  signal?: AbortSignal;
  /** Skip COUNT(*) when the caller already computed total rows. */
  knownTotal?: number;
};

export type RunModVerifyPipelineHandlers = {
  onProgress?: (progress: VerifyPipelineProgress) => void;
  onActionLog?: (entry: {
    stringId: number;
    edid: string | null;
    path: string | null;
    signature: string | null;
    source: string;
    action: 'approved' | 'fixed' | 'issue';
    detail?: string | null;
  }) => void;
  collectIssue?: (issue: LlmVerifyIssue) => void;
};

export type VerifyPipelineSummary = {
  done: number;
  approved: number;
  fixed: number;
  suspicious: number;
  incorrect: number;
  errors: number;
};

type VerifyBatchPersistJob = {
  okStringIds: number[];
  fixes: Array<{ stringId: number; text: string; row: VerifyStringRow }>;
  rewrites: Array<{ item: LlmVerifyItem; row: VerifyStringRow }>;
  issues: LlmVerifyIssue[];
  rowById: Map<number, VerifyStringRow>;
  progressRows: Array<{
    result: Awaited<ReturnType<typeof verifyTranslationsWithLlm>>[number];
    row?: VerifyStringRow;
    issue?: LlmVerifyIssue;
    verdictCounts?: { suspicious?: boolean; incorrect?: boolean; error?: boolean };
  }>;
};

export const runModVerifyPipeline = async (
  db: Tx,
  opts: RunModVerifyPipelineOpts,
  handlers: RunModVerifyPipelineHandlers = {},
): Promise<VerifyPipelineSummary> => {
  const dryRun = opts.dryRun === true;
  const autoApproveVerified = !dryRun && opts.autoApproveVerified !== false;
  const fixSuspicious = opts.fixSuspicious === true;
  const force = opts.force === true;
  const dbChunkSize = Math.max(50, opts.dbChunkSize ?? CONFIG.dbChunkSize);
  const rag = opts.rag ?? {};
  const shouldCancel = opts.shouldCancel;

  const total =
    opts.knownTotal ??
    (await countVerifiableStrings(db, opts.modId, opts.srcLang, opts.targetLang, force));
  if (total === 0) {
    throw new Error('No strings pending review');
  }

  if (!rag.disableRag) {
    await requirePgvectorForRag(db);
  }

  const glossaryAll = await loadGlossaryEntries(db, opts.srcLang, opts.targetLang);
  const projectSettings = await getAllProjectSettings(db);
  const ragMaxExamples = clampRagMaxExamples(projectSettings['llm.rag_max_examples']);
  const ragMinSimilarity = Math.min(1, Math.max(0, projectSettings['llm.rag_min_similarity']));
  const model = getTranslateModel();
  const chatConcurrency = llmChatPipelineConcurrency();
  const persistConcurrency = Math.max(2, Math.min(8, CONFIG.dbPoolMax));
  const persistPool = new Semaphore(persistConcurrency);
  const persistJobs: Promise<void>[] = [];

  let done = 0;
  let approved = 0;
  let fixed = 0;
  let suspicious = 0;
  let incorrect = 0;
  let errors = 0;
  let dbPage = 0;

  const emitProgress = (extra?: Partial<VerifyPipelineProgress>): void => {
    handlers.onProgress?.({
      done,
      approved,
      fixed,
      suspicious,
      incorrect,
      errors,
      dbPage,
      ...extra,
    });
  };

  const logAction = (
    row: VerifyStringRow,
    action: 'approved' | 'fixed' | 'issue',
    detail?: string | null,
  ): void => {
    if (!autoApproveVerified && action !== 'issue') return;
    handlers.onActionLog?.({
      stringId: row.string_id,
      edid: row.edid,
      path: row.path,
      signature: row.signature,
      source: row.source,
      action,
      detail: detail ?? null,
    });
  };

  type RagByStringId = Awaited<ReturnType<typeof fetchReferenceExamplesBatch>>;

  const fetchChunkRag = async (llmChunk: VerifyStringRow[]): Promise<RagByStringId> => {
    if (llmChunk.length === 0 || shouldCancel?.() || rag.disableRag) return new Map();
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
        rag,
      );
    } catch (err) {
      logVerify.warn('RAG fetch failed for verify chunk; continuing without examples', {
        modId: opts.modId,
        err: err instanceof Error ? err.message : String(err),
        stringIds: llmChunk.map((row) => row.string_id),
      });
      return new Map();
    }
  };

  const buildBatchPersistJob = (
    llmChunk: VerifyStringRow[],
    ragByStringId: RagByStringId,
    results: Awaited<ReturnType<typeof verifyTranslationsWithLlm>>,
  ): VerifyBatchPersistJob => {
    const rowById = new Map(llmChunk.map((row) => [row.string_id, row]));
    const okStringIds: number[] = [];
    const fixes: VerifyBatchPersistJob['fixes'] = [];
    const rewrites: VerifyBatchPersistJob['rewrites'] = [];
    const issues: LlmVerifyIssue[] = [];
    const progressRows: VerifyBatchPersistJob['progressRows'] = [];

    for (const result of results) {
      const row = rowById.get(result.id);

      if (result.verdict === 'ok') {
        okStringIds.push(result.id);
        progressRows.push({ result, row });
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
        fixSuspicious,
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
        rewriteFromSource: fixAction.kind === 'rewrite_from_source',
      };

      issues.push(issue);
      handlers.collectIssue?.(issue);

      if (!dryRun && fixAction.kind === 'apply') {
        fixes.push({ stringId: result.id, text: fixAction.suggestion, row });
      } else if (!dryRun && fixAction.kind === 'rewrite_from_source') {
        rewrites.push({ item: itemForValidation, row });
      } else if (fixAction.kind === 'approve_as_ok') {
        okStringIds.push(result.id);
      } else if (!dryRun && fixAction.kind === 'reject_fix') {
        logVerify.warn('verify fix skipped — suggestion failed validation', {
          modId: opts.modId,
          stringId: result.id,
          reason: fixAction.message,
        });
      }

      progressRows.push({
        result,
        row,
        issue,
        verdictCounts: {
          suspicious: result.verdict === 'suspicious',
          incorrect: result.verdict === 'incorrect',
        },
      });
    }

    return { okStringIds, fixes, rewrites, issues, rowById, progressRows };
  };

  const scheduleBatchPersist = (job: VerifyBatchPersistJob): void => {
    persistJobs.push(
      persistPool.run(async () => {
        const approvedIds = new Set<number>();

        if (!dryRun) {
          if (job.rewrites.length > 0) {
            const rewriteRowById = new Map(job.rewrites.map((entry) => [entry.item.id, entry.row]));
            try {
              const rewritten = await rewriteVerifyTranslationsFromSource({
                items: job.rewrites.map((entry) => entry.item),
                model,
                srcLang: opts.srcLang,
                targetLang: opts.targetLang,
                game: opts.game,
                modName: opts.modName,
                signal: opts.signal,
              });
              for (const row of rewritten) {
                const sourceRow = rewriteRowById.get(row.id);
                if (!sourceRow) continue;
                try {
                  await upsertTranslation(db, row.id, row.text, 'auto', opts.targetLang);
                  fixed++;
                  logAction(sourceRow, 'fixed', row.text);
                } catch (err) {
                  errors++;
                  logVerify.warn('verify source rewrite persist failed', {
                    modId: opts.modId,
                    stringId: row.id,
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }
              const rewrittenIds = new Set(rewritten.map((row) => row.id));
              for (const { item } of job.rewrites) {
                if (rewrittenIds.has(item.id)) continue;
                logVerify.warn('verify source rewrite produced no valid translation', {
                  modId: opts.modId,
                  stringId: item.id,
                });
              }
            } catch (err) {
              errors += job.rewrites.length;
              logVerify.warn('verify source rewrite batch failed', {
                modId: opts.modId,
                stringIds: job.rewrites.map((entry) => entry.item.id),
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          for (const fix of job.fixes) {
            try {
              await upsertTranslation(db, fix.stringId, fix.text, 'auto', opts.targetLang);
              fixed++;
              logAction(fix.row, 'fixed', fix.text);
            } catch (err) {
              errors++;
              logVerify.warn('verify auto-fix failed', {
                modId: opts.modId,
                stringId: fix.stringId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }

          if (autoApproveVerified && job.okStringIds.length > 0) {
            try {
              const promoted = await approveVerifiedTranslations(
                db,
                job.okStringIds,
                opts.targetLang,
              );
              approved += promoted;
              for (const id of job.okStringIds) approvedIds.add(id);
            } catch (err) {
              errors += job.okStringIds.length;
              logVerify.warn('verify auto-approve failed for chunk', {
                modId: opts.modId,
                error: err instanceof Error ? err.message : String(err),
                stringIds: job.okStringIds,
              });
            }
          }
        }

        for (const entry of job.progressRows) {
          done++;
          if (entry.verdictCounts?.suspicious) suspicious++;
          if (entry.verdictCounts?.incorrect) incorrect++;
          if (entry.row && approvedIds.has(entry.result.id)) {
            logAction(entry.row, 'approved');
            emitProgress();
            continue;
          }
          if (entry.result.verdict === 'ok') {
            emitProgress();
            continue;
          }
          if (entry.row) {
            if (autoApproveVerified) {
              logAction(entry.row, 'issue', entry.result.reason);
              emitProgress();
              continue;
            }
            emitProgress({ issue: entry.issue });
            continue;
          }
          emitProgress();
        }
      }),
    );
  };

  const buildVerifyItems = (
    llmChunk: VerifyStringRow[],
    ragByStringId: RagByStringId,
  ): LlmVerifyItem[] =>
    llmChunk.map((row) => {
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

  const verifyChunkOnce = async (
    llmChunk: VerifyStringRow[],
    ragByStringId: RagByStringId,
    enqueueSplit: (parts: VerifyStringRow[][]) => void,
  ) => {
    const items = buildVerifyItems(llmChunk, ragByStringId);

    try {
      const results = await withRequestDeadline(CONFIG.llmRequestTimeoutMs, opts.signal, (signal) =>
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

      scheduleBatchPersist(buildBatchPersistJob(llmChunk, ragByStringId, results));
    } catch (err) {
      if (isLlmVerifyMissingIdsError(err)) {
        const missingSet = new Set(err.missingIds);
        const okRows = llmChunk.filter((row) => !missingSet.has(row.string_id));
        if (err.partialResults.length > 0) {
          const okItems = buildVerifyItems(okRows, ragByStringId);
          scheduleBatchPersist(
            buildBatchPersistJob(
              okRows,
              ragByStringId,
              finalizeVerifyItemResults(okItems, [...err.partialResults], opts.game),
            ),
          );
        }
        const missingRows = llmChunk.filter((row) => missingSet.has(row.string_id));
        logVerify.warn('partial LLM verify batch — solo retry for missing rows', {
          ok: okRows.length,
          missing: missingRows.map((row) => row.string_id),
        });
        enqueueSoloChunks(missingRows, enqueueSplit);
        return;
      }
      if (isLlmTimeoutError(err) && llmChunk.length > 1) {
        logVerify.warn('LLM verify batch timeout — solo retry', {
          chunkSize: llmChunk.length,
          stringIds: llmChunk.map((row) => row.string_id),
        });
        enqueueSoloChunks(llmChunk, enqueueSplit);
        return;
      }
      throw err;
    }
  };

  const emitChunkFailure = (llmChunk: readonly VerifyStringRow[], message: string): void => {
    logVerify.error('verify chunk failed; continuing', {
      modId: opts.modId,
      error: message,
      stringIds: llmChunk.map((row) => row.string_id),
    });
    for (const row of llmChunk) {
      done++;
      errors++;
      emitProgress({
        chunkError: { stringIds: [row.string_id], message },
      });
    }
  };

  logVerify.info('verify pipeline started', {
    modId: opts.modId,
    total,
    dryRun,
    autoApproveVerified,
    fixSuspicious,
    force,
    dbChunkSize,
    llmBatchSize: CONFIG.batchSize,
    chatConcurrency,
    llmMaxParallel: CONFIG.llmMaxParallel,
    embedMaxParallel: CONFIG.embedMaxParallel,
    rag,
  });

  async function* verifyChunkFeed(): AsyncGenerator<readonly VerifyStringRow[]> {
    for await (const unit of iterateVerifyLlmChunks(db, {
      modId: opts.modId,
      srcLang: opts.srcLang,
      targetLang: opts.targetLang,
      dbChunkSize,
      force,
    })) {
      dbPage = unit.page;
      yield unit.chunk;
    }
  }

  await runLlmChunkWorkPoolFromFeed(verifyChunkFeed(), {
    concurrency: chatConcurrency,
    maxBufferedChunks: chatConcurrency * 2,
    shouldAbort: shouldCancel,
    runOnce: async (chunk, { enqueueSplit }) => {
      const ragByStringId = await fetchChunkRag([...chunk]);
      if (shouldCancel?.()) return;
      if (chunk.length === 1) {
        logVerify.debug('solo LLM verify request', { stringId: chunk[0]!.string_id });
      }
      await verifyChunkOnce([...chunk], ragByStringId, (parts) => enqueueSplit(parts));
    },
    shouldSplit: (err) => isLlmVerifyMissingIdsError(err) || isLlmTimeoutError(err),
    onFailure: (failed, message) => emitChunkFailure(failed, message),
    log: logVerify,
    operation: 'verify',
    itemIds: (chunk) => chunk.map((row) => row.string_id),
  });

  if (persistJobs.length > 0) {
    logVerify.debug('draining verify persist queue', { jobs: persistJobs.length });
    await Promise.all(persistJobs);
  }

  const summary: VerifyPipelineSummary = {
    done,
    approved,
    fixed,
    suspicious,
    incorrect,
    errors,
  };

  logVerify.info('verify pipeline completed', { modId: opts.modId, dryRun, total, ...summary });
  return summary;
};

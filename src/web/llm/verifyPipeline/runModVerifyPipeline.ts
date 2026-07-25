/**
 * High-throughput LLM verify pipeline — continuous work queue with DB prefetch
 * and async persist so chat slots stay saturated on the LLM host.
 */
import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { clampRagMaxExamples } from '../../../llm/ragConstants';
import { requirePgvectorForRag } from '../../../llm/rag';
import { getAllProjectSettings } from '../../services/projectSettings';
import { runLlmChunkWorkPoolFromFeed } from '../../../llm/chunkRecovery';
import { isLlmVerifyMissingIdsError } from '../../../llm/verifyTranslate';
import { isLlmResponseTruncatedError } from '../../../llm/translate';
import { isLlmTimeoutError } from '../../../llm/retry';
import { llmChatPipelineConcurrency } from '../../../llm/requestPool';
import { logVerify } from '../../../logging/loggers';
import { loadGlossaryEntries } from '../glossaryForLlm';
import { countVerifiableStrings, iterateVerifyLlmChunks } from '../verifyService/queries';
import { createPersistPool, drainPersistJobs, type BatchPersistCounters } from './batchPersist';
import {
  createVerifyChunkContext,
  emitChunkFailure,
  fetchChunkRag,
  verifyChunkOnce,
} from './verifyChunk';
import type {
  RunModVerifyPipelineHandlers,
  RunModVerifyPipelineOpts,
  VerifyPipelineProgress,
  VerifyPipelineSummary,
  VerifyStringRow,
} from './types';

export type {
  RunModVerifyPipelineHandlers,
  RunModVerifyPipelineOpts,
  VerifyPipelineProgress,
  VerifyPipelineSummary,
  VerifyStringRow,
} from './types';

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
  const chatConcurrency = llmChatPipelineConcurrency();
  const { pool: persistPool, jobs: persistJobs } = createPersistPool();

  const counters: BatchPersistCounters = {
    done: 0,
    approved: 0,
    fixed: 0,
    suspicious: 0,
    incorrect: 0,
    errors: 0,
  };
  let dbPage = 0;

  const emitProgress = (extra?: Partial<VerifyPipelineProgress>): void => {
    handlers.onProgress?.({
      done: counters.done,
      approved: counters.approved,
      fixed: counters.fixed,
      suspicious: counters.suspicious,
      incorrect: counters.incorrect,
      errors: counters.errors,
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

  const persistCtx = {
    db,
    opts,
    dryRun,
    autoApproveVerified,
    model: '',
    counters,
    persistPool,
    persistJobs,
    emitProgress,
    logAction,
  };

  const chunkCtx = createVerifyChunkContext(
    db,
    opts,
    persistCtx,
    glossaryAll,
    ragMaxExamples,
    ragMinSimilarity,
    rag,
    fixSuspicious,
    dryRun,
    handlers.collectIssue,
  );
  persistCtx.model = chunkCtx.model;

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
      const ragByStringId = await fetchChunkRag(chunkCtx, [...chunk]);
      if (shouldCancel?.()) return;
      if (chunk.length === 1) {
        logVerify.debug('solo LLM verify request', { stringId: chunk[0]!.string_id });
      }
      await verifyChunkOnce(chunkCtx, [...chunk], ragByStringId, (parts) => enqueueSplit(parts));
    },
    shouldSplit: (err) =>
      isLlmVerifyMissingIdsError(err) || isLlmTimeoutError(err) || isLlmResponseTruncatedError(err),
    onFailure: (failed, message) => emitChunkFailure(chunkCtx, failed, message),
    log: logVerify,
    operation: 'verify',
    itemIds: (chunk) => chunk.map((row) => row.string_id),
  });

  await drainPersistJobs(persistJobs);

  const summary: VerifyPipelineSummary = { ...counters };
  logVerify.info('verify pipeline completed', { modId: opts.modId, dryRun, total, ...summary });
  return summary;
};

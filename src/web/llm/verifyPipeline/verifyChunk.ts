import type { Tx } from '../../../db';
import { CONFIG, getTranslateModel } from '../../../config';
import { filterVerifyReferenceExamples } from '../../../llm/verifyReferenceExamples';
import {
  verifyTranslationsWithLlm,
  isLlmVerifyMissingIdsError,
  finalizeVerifyItemResults,
  type LlmVerifyItem,
} from '../../../llm/verifyTranslate';
import { fetchReferenceExamplesBatch, type RagRetrievalOptions } from '../../../llm/rag';
import { enqueueSoloChunks } from '../../../llm/chunkRecovery';
import { withRequestDeadline } from '../../../llm/requestDeadline';
import { isLlmTimeoutError } from '../../../llm/retry';
import { logVerify } from '../../../logging/loggers';
import { parseRecordLocation } from '../../../utils/recordLocation';
import { dialogParticipantsFromRow } from '../../data/queries/dialogs';
import { buildLlmParticipantPayload } from '../../../llm/dialogParticipants';
import { relevantGlossaryEntries, type GlossaryEntryWithRe } from '../glossaryForLlm';
import { buildBatchPersistJob } from './buildBatchPersistJob';
import { scheduleBatchPersist, type BatchPersistContext } from './batchPersist';
import type { RunModVerifyPipelineOpts, VerifyStringRow } from './types';

type RagByStringId = Awaited<ReturnType<typeof fetchReferenceExamplesBatch>>;

export type VerifyChunkContext = {
  db: Tx;
  opts: RunModVerifyPipelineOpts;
  model: string;
  glossaryAll: GlossaryEntryWithRe[];
  ragMaxExamples: number;
  ragMinSimilarity: number;
  rag: RagRetrievalOptions;
  fixSuspicious: boolean;
  dryRun: boolean;
  persistCtx: BatchPersistContext;
  shouldCancel?: () => boolean;
  collectIssue?: (issue: import('../verifyService/queries').LlmVerifyIssue) => void;
};

export const fetchChunkRag = async (
  ctx: VerifyChunkContext,
  llmChunk: VerifyStringRow[],
): Promise<RagByStringId> => {
  if (llmChunk.length === 0 || ctx.shouldCancel?.() || ctx.rag.disableRag) return new Map();
  try {
    return await fetchReferenceExamplesBatch(
      ctx.db,
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
      ctx.opts.srcLang,
      ctx.opts.targetLang,
      ctx.ragMaxExamples,
      ctx.ragMinSimilarity,
      ctx.rag,
    );
  } catch (err) {
    logVerify.warn('RAG fetch failed for verify chunk; continuing without examples', {
      modId: ctx.opts.modId,
      err: err instanceof Error ? err.message : String(err),
      stringIds: llmChunk.map((row) => row.string_id),
    });
    return new Map();
  }
};

export const buildVerifyItems = (
  llmChunk: VerifyStringRow[],
  ragByStringId: RagByStringId,
): LlmVerifyItem[] =>
  llmChunk.map((row) => {
    const { grup, field } = parseRecordLocation(row.signature, row.path);
    const participants = dialogParticipantsFromRow(row, field);
    return {
      id: row.string_id,
      source: row.source,
      translation: row.translation,
      grup,
      edid: row.edid,
      field,
      context: row.context,
      ...buildLlmParticipantPayload(participants),
      reference_examples: filterVerifyReferenceExamples(ragByStringId.get(row.string_id), {
        grup,
        field,
        source: row.source,
      }),
    };
  });

export const verifyChunkOnce = async (
  ctx: VerifyChunkContext,
  llmChunk: VerifyStringRow[],
  ragByStringId: RagByStringId,
  enqueueSplit: (parts: readonly (readonly VerifyStringRow[])[]) => void,
): Promise<void> => {
  const items = buildVerifyItems(llmChunk, ragByStringId);

  try {
    const results = await withRequestDeadline(
      CONFIG.llmRequestTimeoutMs,
      ctx.opts.signal,
      (signal) =>
        verifyTranslationsWithLlm({
          items,
          model: ctx.model,
          srcLang: ctx.opts.srcLang,
          targetLang: ctx.opts.targetLang,
          game: ctx.opts.game,
          modName: ctx.opts.modName,
          glossary: relevantGlossaryEntries(
            ctx.glossaryAll,
            llmChunk.map((row) => row.source),
          ),
          signal,
        }),
    );

    scheduleBatchPersist(
      ctx.persistCtx,
      buildBatchPersistJob(
        llmChunk,
        results,
        ctx.opts,
        ctx.fixSuspicious,
        ctx.dryRun,
        ctx.collectIssue,
      ),
    );
  } catch (err) {
    if (isLlmVerifyMissingIdsError(err)) {
      const missingSet = new Set(err.missingIds);
      const okRows = llmChunk.filter((row) => !missingSet.has(row.string_id));
      if (err.partialResults.length > 0) {
        const okItems = buildVerifyItems(okRows, ragByStringId);
        scheduleBatchPersist(
          ctx.persistCtx,
          buildBatchPersistJob(
            okRows,
            finalizeVerifyItemResults(okItems, [...err.partialResults], ctx.opts.game),
            ctx.opts,
            ctx.fixSuspicious,
            ctx.dryRun,
            ctx.collectIssue,
          ),
        );
      }
      const missingRows = llmChunk.filter((row) => missingSet.has(row.string_id));
      if (llmChunk.length > 1) {
        logVerify.warn('partial LLM verify batch — solo retry for missing rows', {
          ok: okRows.length,
          missing: missingRows.map((row) => row.string_id),
        });
        enqueueSoloChunks(missingRows, enqueueSplit);
        return;
      }
      throw err;
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

export const emitChunkFailure = (
  ctx: VerifyChunkContext,
  llmChunk: readonly VerifyStringRow[],
  message: string,
): void => {
  logVerify.error('verify chunk failed; continuing', {
    modId: ctx.opts.modId,
    error: message,
    stringIds: llmChunk.map((row) => row.string_id),
  });
  for (const row of llmChunk) {
    ctx.persistCtx.counters.done++;
    ctx.persistCtx.counters.errors++;
    ctx.persistCtx.emitProgress({
      chunkError: { stringIds: [row.string_id], message },
    });
  }
};

export const createVerifyChunkContext = (
  db: Tx,
  opts: RunModVerifyPipelineOpts,
  persistCtx: BatchPersistContext,
  glossaryAll: GlossaryEntryWithRe[],
  ragMaxExamples: number,
  ragMinSimilarity: number,
  rag: RagRetrievalOptions,
  fixSuspicious: boolean,
  dryRun: boolean,
  collectIssue?: (issue: import('../verifyService/queries').LlmVerifyIssue) => void,
): VerifyChunkContext => ({
  db,
  opts,
  model: getTranslateModel(),
  glossaryAll,
  ragMaxExamples,
  ragMinSimilarity,
  rag,
  fixSuspicious,
  dryRun,
  persistCtx,
  shouldCancel: opts.shouldCancel,
  collectIssue,
});

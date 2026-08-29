import type { Tx } from '../../../../../src/db';
import { CONFIG, getTranslateModel } from '../../../../../src/config';
import { filterVerifyReferenceExamples } from '../../../../../src/llm/verifyReferenceExamples';
import {
  verifyTranslationsWithLlm,
  isLlmVerifyMissingIdsError,
  finalizeVerifyItemResults,
  type LlmVerifyItem,
} from '../../../../../src/llm/verifyTranslate';
import { isLlmResponseTruncatedError } from '../../../../../src/llm/translate';
import { fetchReferenceExamplesBatch, type RagRetrievalOptions } from '../../../../../src/llm/rag';
import { enqueueSoloChunks } from '../../../../../src/llm/chunkRecovery';
import { withRequestDeadline } from '../../../../../src/llm/requestDeadline';
import { isLlmTimeoutError } from '../../../../../src/llm/retry';
import { logVerify } from '../../../../../src/logging/loggers';
import { parseRecordLocation } from '../../../../../src/utils/recordLocation';
import { dialogParticipantsFromRow } from '../../../../../src/web/data/queries/dialogs';
import { buildLlmParticipantPayload } from '../../../../../src/llm/dialogParticipants';
import { relevantGlossaryEntries, type GlossaryEntryWithRe } from '../../shared/glossaryForLlm';
import { buildBatchPersistJob } from './buildBatchPersistJob';
import { scheduleBatchPersist, type BatchPersistContext } from './batchPersist';
import {
  rowNeedsLongTextVerify,
  verifyLongTextAfterTruncation,
  verifyLongTextItem,
} from './verifyLongText';
import type { RunModVerifyPipelineOpts, VerifyChunkContext, VerifyStringRow } from './types';

type RagByStringId = Awaited<ReturnType<typeof fetchReferenceExamplesBatch>>;

const verifyLongRows = async (
  ctx: VerifyChunkContext,
  rows: VerifyStringRow[],
  ragByStringId: RagByStringId,
): Promise<void> => {
  for (const row of rows) {
    const item = buildVerifyItems([row], ragByStringId)[0]!;
    const result = await verifyLongTextItem(ctx, item);
    scheduleBatchPersist(
      ctx.persistCtx,
      buildBatchPersistJob(
        [row],
        [result],
        ctx.opts,
        ctx.fixSuspicious,
        ctx.dryRun,
        ctx.collectIssue,
      ),
    );
  }
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
  const longRows = llmChunk.filter((row) => rowNeedsLongTextVerify(row));
  const normalRows = llmChunk.filter((row) => !rowNeedsLongTextVerify(row));

  if (longRows.length > 0) {
    await verifyLongRows(ctx, longRows, ragByStringId);
  }
  if (normalRows.length === 0) return;

  const items = buildVerifyItems(normalRows, ragByStringId);

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
            normalRows.map((row) => row.source),
          ),
          signal,
        }),
    );

    scheduleBatchPersist(
      ctx.persistCtx,
      buildBatchPersistJob(
        normalRows,
        results,
        ctx.opts,
        ctx.fixSuspicious,
        ctx.dryRun,
        ctx.collectIssue,
      ),
    );
  } catch (err) {
    if (isLlmResponseTruncatedError(err) && normalRows.length === 1) {
      const row = normalRows[0]!;
      const item = items[0]!;
      const merged = await verifyLongTextAfterTruncation(ctx, item);
      if (merged != null) {
        scheduleBatchPersist(
          ctx.persistCtx,
          buildBatchPersistJob(
            [row],
            [merged],
            ctx.opts,
            ctx.fixSuspicious,
            ctx.dryRun,
            ctx.collectIssue,
          ),
        );
        return;
      }
    }
    if (isLlmVerifyMissingIdsError(err)) {
      const missingSet = new Set(err.missingIds);
      const okRows = normalRows.filter((row) => !missingSet.has(row.string_id));
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
      const missingRows = normalRows.filter((row) => missingSet.has(row.string_id));
      if (normalRows.length > 1) {
        logVerify.warn('partial LLM verify batch — solo retry for missing rows', {
          ok: okRows.length,
          missing: missingRows.map((row) => row.string_id),
        });
        enqueueSoloChunks(missingRows, enqueueSplit);
        return;
      }
      throw err;
    }
    if (isLlmTimeoutError(err) && normalRows.length > 1) {
      logVerify.warn('LLM verify batch timeout — solo retry', {
        chunkSize: normalRows.length,
        stringIds: normalRows.map((row) => row.string_id),
      });
      enqueueSoloChunks(normalRows, enqueueSplit);
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
  collectIssue?: (issue: import('../queries').LlmVerifyIssue) => void,
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

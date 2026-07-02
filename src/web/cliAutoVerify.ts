/**
 * CLI-oriented mod translation verification — paginated DB reads, optional auto-fix.
 */
import type { Tx } from '../db';
import { CONFIG, getTranslateModel } from '../config';
import { filterVerifyReferenceExamples } from '../llm/verifyReferenceExamples';
import { canApproveAppliedFix, resolveVerifyFixAction } from '../llm/verifySuggestionGuards';
import { verifyTranslationsWithLlm, type LlmVerifyItem } from '../llm/verifyTranslate';
import { clampRagMaxExamples } from '../llm/ragConstants';
import {
  fetchReferenceExamplesBatch,
  requirePgvectorForRag,
  type RagRetrievalOptions,
} from '../llm/ragService';
import { getAllProjectSettings } from './projectSettings';
import { approveVerifiedTranslations, upsertTranslation } from './queries';
import { parseRecordLocation } from '../utils/recordLocation';
import { runPoolOverAsyncIterable } from '../utils/concurrency';
import { runLlmChunkWithRecovery } from '../llm/chunkRecovery';
import { withRequestDeadline } from '../llm/requestDeadline';
import { llmChatPipelineConcurrency } from '../llm/requestPool';
import { logVerify } from '../logging/loggers';
import { loadGlossaryEntries, relevantGlossaryEntries } from './glossaryForLlm';
import {
  countVerifiableStrings,
  iterateVerifyLlmChunks,
  LLM_VERIFY_DB_CHUNK_SIZE,
  type LlmVerifyIssue,
  type VerifyLlmWorkUnit,
} from './llmVerifyService';

export type CliVerifyProgressEvent =
  | { type: 'started'; total: number; dryRun: boolean; dbChunkSize: number }
  | {
      type: 'progress';
      done: number;
      total: number;
      approved: number;
      fixed: number;
      suspicious: number;
      incorrect: number;
      errors: number;
      dbPage: number;
      issue?: LlmVerifyIssue;
      chunkError?: { stringIds: number[]; message: string };
    }
  | {
      type: 'done';
      done: number;
      total: number;
      approved: number;
      fixed: number;
      suspicious: number;
      incorrect: number;
      errors: number;
    }
  | { type: 'error'; error: string };

export type CliVerifyResult = {
  done: number;
  total: number;
  approved: number;
  fixed: number;
  suspicious: number;
  incorrect: number;
  errors: number;
};

type VerifyStringRow = VerifyLlmWorkUnit['chunk'][number];

export const runCliModVerify = async (
  db: Tx,
  opts: {
    modId: number;
    srcLang: string;
    targetLang: string;
    modName?: string | null;
    game?: string | null;
    dryRun?: boolean;
    /** Promote passing rows to reviewed when not dry-run (default true). */
    autoApproveVerified?: boolean;
    /** Apply LLM suggestions for suspicious verdicts (default false — only incorrect rows are fixed). */
    fixSuspicious?: boolean;
    /** Re-verify reviewed/human rows, not only pending draft/tm/fuzzy/auto (default false). */
    force?: boolean;
    dbChunkSize?: number;
    rag?: RagRetrievalOptions;
  },
  onEvent?: (event: CliVerifyProgressEvent) => void,
): Promise<CliVerifyResult> => {
  const dryRun = opts.dryRun === true;
  const autoApproveVerified = !dryRun && opts.autoApproveVerified !== false;
  const fixSuspicious = opts.fixSuspicious === true;
  const force = opts.force === true;
  const dbChunkSize = Math.max(50, opts.dbChunkSize ?? LLM_VERIFY_DB_CHUNK_SIZE);
  const rag = opts.rag ?? {};

  const total = await countVerifiableStrings(db, opts.modId, opts.srcLang, opts.targetLang, force);
  if (total === 0) {
    throw new Error('No strings pending review');
  }

  logVerify.info('cli verify started', {
    modId: opts.modId,
    total,
    dryRun,
    autoApproveVerified,
    fixSuspicious,
    force,
    dbChunkSize,
    rag,
    srcLang: opts.srcLang,
    targetLang: opts.targetLang,
  });

  onEvent?.({ type: 'started', total, dryRun, dbChunkSize });

  if (!rag.disableRag) {
    await requirePgvectorForRag(db);
  }

  const glossaryAll = await loadGlossaryEntries(db, opts.srcLang, opts.targetLang);

  const projectSettings = await getAllProjectSettings(db);
  const ragMaxExamples = clampRagMaxExamples(projectSettings['llm.rag_max_examples']);
  const ragMinSimilarity = Math.min(1, Math.max(0, projectSettings['llm.rag_min_similarity']));
  const model = getTranslateModel();
  const chatConcurrency = llmChatPipelineConcurrency();

  type RagByStringId = Awaited<ReturnType<typeof fetchReferenceExamplesBatch>>;

  const fetchChunkRag = async (llmChunk: VerifyStringRow[]): Promise<RagByStringId> => {
    if (llmChunk.length === 0) return new Map();
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

  let done = 0;
  let approved = 0;
  let fixed = 0;
  let suspicious = 0;
  let incorrect = 0;
  let errors = 0;
  let dbPage = 0;

  const emitChunkFailure = (llmChunk: VerifyStringRow[], message: string): void => {
    logVerify.error('cli verify chunk failed; continuing with next chunk', {
      modId: opts.modId,
      error: message,
      stringIds: llmChunk.map((row) => row.string_id),
    });
    for (const row of llmChunk) {
      done++;
      errors++;
      onEvent?.({
        type: 'progress',
        done,
        total,
        approved,
        fixed,
        suspicious,
        incorrect,
        errors,
        dbPage,
        chunkError: { stringIds: [row.string_id], message },
      });
    }
  };

  const processLlmBatchInner = async (
    llmChunk: VerifyStringRow[],
    ragByStringId: RagByStringId,
  ): Promise<void> => {
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
      undefined,
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
    for (const result of results) {
      done++;
      const row = rowById.get(result.id);

      if (result.verdict === 'ok') {
        okStringIds.push(result.id);
        onEvent?.({
          type: 'progress',
          done,
          total,
          approved,
          fixed,
          suspicious,
          incorrect,
          errors,
          dbPage,
        });
        continue;
      }

      if (!row) continue;

      if (result.verdict === 'suspicious') suspicious++;
      else incorrect++;

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
      };

      if (!dryRun && fixAction.kind === 'apply') {
        try {
          await upsertTranslation(db, result.id, fixAction.suggestion, 'auto', opts.targetLang);
          fixed++;
          if (canApproveAppliedFix(itemForValidation, fixAction.suggestion, opts.game)) {
            validatedFixedIds.push(result.id);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logVerify.error('cli verify fix failed; continuing', {
            modId: opts.modId,
            stringId: result.id,
            error: message,
          });
          errors++;
        }
      } else if (!dryRun && fixAction.kind === 'reject_fix') {
        logVerify.warn('cli verify fix skipped — suggestion failed validation', {
          modId: opts.modId,
          stringId: result.id,
          reason: fixAction.message,
        });
      }

      onEvent?.({
        type: 'progress',
        done,
        total,
        approved,
        fixed,
        suspicious,
        incorrect,
        errors,
        dbPage,
        issue,
      });
    }

    if (autoApproveVerified && (okStringIds.length > 0 || validatedFixedIds.length > 0)) {
      const toApprove = [...okStringIds, ...validatedFixedIds];
      try {
        const promoted = await approveVerifiedTranslations(db, toApprove, opts.targetLang);
        approved += promoted;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logVerify.warn('cli verify auto-approve failed for chunk; continuing', {
          modId: opts.modId,
          error: message,
          stringIds: toApprove,
        });
        errors += toApprove.length;
      }

      onEvent?.({
        type: 'progress',
        done,
        total,
        approved,
        fixed,
        suspicious,
        incorrect,
        errors,
        dbPage,
      });
    }
  };

  const processLlmChunk = async (llmChunk: VerifyStringRow[]): Promise<void> => {
    if (llmChunk.length === 0) return;
    const ragByStringId = await fetchChunkRag(llmChunk);
    await runLlmChunkWithRecovery({
      chunk: llmChunk,
      runOnce: (chunk) => processLlmBatchInner([...chunk], ragByStringId),
      onFailure: (failed, message) => emitChunkFailure([...failed], message),
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
        dbChunkSize,
        force,
      }),
      chatConcurrency,
      async ({ page, chunk }) => {
        dbPage = page;
        await processLlmChunk(chunk);
      },
    );

    const summary: CliVerifyResult = {
      done,
      total,
      approved,
      fixed,
      suspicious,
      incorrect,
      errors,
    };

    logVerify.info('cli verify completed', { modId: opts.modId, dryRun, ...summary });
    onEvent?.({ type: 'done', ...summary });
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logVerify.error('cli verify failed', { modId: opts.modId, error: message });
    onEvent?.({ type: 'error', error: message });
    throw err;
  }
};

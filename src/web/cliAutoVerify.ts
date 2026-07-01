/**
 * CLI-oriented mod translation verification — paginated DB reads, optional auto-fix.
 */
import type { Tx } from '../db';
import { getTranslateModel } from '../config';
import { verifyTranslationsWithLlm, type LlmVerifyItem } from '../llm/verifyTranslate';
import { clampRagMaxExamples } from '../llm/ragConstants';
import { fetchReferenceExamplesBatch, requirePgvectorForRag } from '../llm/ragService';
import { getAllProjectSettings } from './projectSettings';
import { approveVerifiedTranslations, upsertTranslation } from './queries';
import { parseRecordLocation } from '../utils/recordLocation';
import { mapWithConcurrency } from '../utils/concurrency';
import { llmChatPipelineConcurrency, llmRagConcurrency } from '../llm/requestPool';
import { logVerify } from '../logging/loggers';
import {
  countVerifiableStrings,
  loadVerifyChunk,
  LLM_VERIFY_DB_CHUNK_SIZE,
  LLM_VERIFY_LLM_BATCH_SIZE,
  type LlmVerifyIssue,
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

type VerifyStringRow = Awaited<ReturnType<typeof loadVerifyChunk>>[number];

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
    dbChunkSize?: number;
  },
  onEvent?: (event: CliVerifyProgressEvent) => void,
): Promise<CliVerifyResult> => {
  const dryRun = opts.dryRun === true;
  const autoApproveVerified = !dryRun && opts.autoApproveVerified !== false;
  const fixSuspicious = opts.fixSuspicious === true;
  const dbChunkSize = Math.max(50, opts.dbChunkSize ?? LLM_VERIFY_DB_CHUNK_SIZE);

  const total = await countVerifiableStrings(db, opts.modId, opts.srcLang, opts.targetLang);
  if (total === 0) {
    throw new Error('No strings pending review');
  }

  logVerify.info('cli verify started', {
    modId: opts.modId,
    total,
    dryRun,
    autoApproveVerified,
    fixSuspicious,
    dbChunkSize,
    srcLang: opts.srcLang,
    targetLang: opts.targetLang,
  });

  onEvent?.({ type: 'started', total, dryRun, dbChunkSize });

  await requirePgvectorForRag(db);

  const projectSettings = await getAllProjectSettings(db);
  const ragMaxExamples = clampRagMaxExamples(projectSettings['llm.rag_max_examples']);
  const ragMinSimilarity = Math.min(1, Math.max(0, projectSettings['llm.rag_min_similarity']));
  const model = getTranslateModel();
  const ragConcurrency = llmRagConcurrency();
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
  let afterStringId = 0;
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

  const processLlmBatch = async (
    llmChunk: VerifyStringRow[],
    ragByStringId: RagByStringId,
  ): Promise<void> => {
    if (llmChunk.length === 0) return;

    try {
      await processLlmBatchInner(llmChunk, ragByStringId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitChunkFailure(llmChunk, message);
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
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitChunkFailure(llmChunk, message);
      return;
    }

    const okStringIds: number[] = [];
    for (const result of results) {
      done++;
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

      const row = rowById.get(result.id);
      if (!row) continue;

      if (result.verdict === 'suspicious') suspicious++;
      else incorrect++;

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

      const suggestion = result.suggestion;
      const shouldApplySuggestion =
        !dryRun &&
        suggestion &&
        (result.verdict === 'incorrect' || (result.verdict === 'suspicious' && fixSuspicious));

      if (shouldApplySuggestion) {
        try {
          await upsertTranslation(db, result.id, suggestion, 'auto', opts.targetLang);
          fixed++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logVerify.error('cli verify fix failed; continuing', {
            modId: opts.modId,
            stringId: result.id,
            error: message,
          });
          errors++;
        }
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

    if (autoApproveVerified && okStringIds.length > 0) {
      try {
        const promoted = await approveVerifiedTranslations(db, okStringIds, opts.targetLang);
        approved += promoted;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logVerify.warn('cli verify auto-approve failed for chunk; continuing', {
          modId: opts.modId,
          error: message,
          stringIds: okStringIds,
        });
        errors += okStringIds.length;
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

  try {
    while (true) {
      const dbChunk = await loadVerifyChunk(
        db,
        opts.modId,
        opts.srcLang,
        opts.targetLang,
        afterStringId,
        dbChunkSize,
      );
      if (dbChunk.length === 0) break;
      afterStringId = dbChunk[dbChunk.length - 1]!.string_id;
      dbPage++;

      const llmChunks: VerifyStringRow[][] = [];
      for (let i = 0; i < dbChunk.length; i += LLM_VERIFY_LLM_BATCH_SIZE) {
        llmChunks.push(dbChunk.slice(i, i + LLM_VERIFY_LLM_BATCH_SIZE));
      }

      try {
        const ragByChunk = await mapWithConcurrency(llmChunks, ragConcurrency, fetchChunkRag);
        await mapWithConcurrency(llmChunks, chatConcurrency, (chunk, index) =>
          processLlmBatch(chunk, ragByChunk[index]!),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logVerify.error('cli verify db chunk failed; continuing with next chunk', {
          modId: opts.modId,
          error: message,
          stringIds: dbChunk.map((row) => row.string_id),
        });
        for (const row of dbChunk) {
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
      }
    }

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

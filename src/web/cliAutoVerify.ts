/**
 * CLI-oriented mod translation verification — paginated DB reads, optional auto-fix.
 */
import type { Tx } from '../db';
import { CONFIG, getTranslateModel } from '../config';
import { verifyTranslationsWithLlm, type LlmVerifyItem } from '../llm/verifyTranslate';
import { clampRagMaxExamples } from '../llm/ragConstants';
import { fetchReferenceExamplesBatch, requirePgvectorForRag } from '../llm/ragService';
import { getAllProjectSettings } from './projectSettings';
import { approveVerifiedTranslations, upsertTranslation } from './queries';
import { parseRecordLocation } from '../utils/recordLocation';
import { mapWithConcurrency } from '../utils/concurrency';
import { logVerify } from '../logging/loggers';
import {
  countVerifiableStrings,
  loadVerifyChunk,
  LLM_VERIFY_DB_CHUNK_SIZE,
  LLM_VERIFY_LLM_BATCH_SIZE,
  type LlmVerifyIssue,
} from './llmVerifyService';

export type CliVerifyProgressEvent =
  | { type: 'started'; total: number; dryRun: boolean }
  | {
      type: 'progress';
      done: number;
      total: number;
      approved: number;
      fixed: number;
      suspicious: number;
      incorrect: number;
      issue?: LlmVerifyIssue;
    }
  | {
      type: 'done';
      done: number;
      total: number;
      approved: number;
      fixed: number;
      suspicious: number;
      incorrect: number;
    }
  | { type: 'error'; error: string };

export type CliVerifyResult = {
  done: number;
  total: number;
  approved: number;
  fixed: number;
  suspicious: number;
  incorrect: number;
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
    dbChunkSize?: number;
  },
  onEvent?: (event: CliVerifyProgressEvent) => void,
): Promise<CliVerifyResult> => {
  const dryRun = opts.dryRun === true;
  const autoApproveVerified = !dryRun && opts.autoApproveVerified !== false;
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
    dbChunkSize,
    srcLang: opts.srcLang,
    targetLang: opts.targetLang,
  });

  onEvent?.({ type: 'started', total, dryRun });

  await requirePgvectorForRag(db);

  const projectSettings = await getAllProjectSettings(db);
  const ragMaxExamples = clampRagMaxExamples(projectSettings['llm.rag_max_examples']);
  const ragMinSimilarity = Math.min(1, Math.max(0, projectSettings['llm.rag_min_similarity']));
  const model = getTranslateModel();
  const batchConcurrency = CONFIG.llmMaxParallel + CONFIG.embedMaxParallel;

  let done = 0;
  let approved = 0;
  let fixed = 0;
  let suspicious = 0;
  let incorrect = 0;
  let afterId = 0;
  let firstError: string | null = null;

  const processLlmBatch = async (llmChunk: VerifyStringRow[]): Promise<void> => {
    if (firstError) return;

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
      logVerify.error('cli verify chunk failed', { modId: opts.modId, error: message });
      if (!firstError) firstError = message;
      for (const row of llmChunk) {
        done++;
        onEvent?.({
          type: 'progress',
          done,
          total,
          approved,
          fixed,
          suspicious,
          incorrect,
        });
      }
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

      if (!dryRun && result.suggestion) {
        await upsertTranslation(db, result.id, result.suggestion, 'reviewed', opts.targetLang);
        fixed++;
      }

      onEvent?.({
        type: 'progress',
        done,
        total,
        approved,
        fixed,
        suspicious,
        incorrect,
        issue,
      });
    }

    if (autoApproveVerified && okStringIds.length > 0) {
      const promoted = await approveVerifiedTranslations(db, okStringIds, opts.targetLang);
      approved += promoted;
      onEvent?.({
        type: 'progress',
        done,
        total,
        approved,
        fixed,
        suspicious,
        incorrect,
      });
    }
  };

  try {
    while (!firstError) {
      const dbChunk = await loadVerifyChunk(
        db,
        opts.modId,
        opts.srcLang,
        opts.targetLang,
        afterId,
        dbChunkSize,
      );
      if (dbChunk.length === 0) break;
      afterId = dbChunk[dbChunk.length - 1]!.string_id;

      const llmChunks: VerifyStringRow[][] = [];
      for (let i = 0; i < dbChunk.length; i += LLM_VERIFY_LLM_BATCH_SIZE) {
        llmChunks.push(dbChunk.slice(i, i + LLM_VERIFY_LLM_BATCH_SIZE));
      }

      await mapWithConcurrency(llmChunks, batchConcurrency, processLlmBatch);
    }

    if (firstError) {
      onEvent?.({ type: 'error', error: firstError });
      throw new Error(firstError);
    }

    const summary: CliVerifyResult = {
      done,
      total,
      approved,
      fixed,
      suspicious,
      incorrect,
    };

    logVerify.info('cli verify completed', { modId: opts.modId, dryRun, ...summary });
    onEvent?.({ type: 'done', ...summary });
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!firstError) {
      logVerify.error('cli verify failed', { modId: opts.modId, error: message });
      onEvent?.({ type: 'error', error: message });
    }
    throw err;
  }
};

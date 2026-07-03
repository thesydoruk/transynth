/**
 * CLI-oriented mod translation verification — paginated DB reads, optional auto-fix.
 */
import type { Tx } from '../../db';
import type { RagRetrievalOptions } from '../../llm/ragService';
import { logVerify } from '../../logging/loggers';
import { runModVerifyPipeline } from './llmVerifyPipeline';
import {
  countVerifiableStrings,
  LLM_VERIFY_DB_CHUNK_SIZE,
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
  const dbChunkSize = Math.max(50, opts.dbChunkSize ?? LLM_VERIFY_DB_CHUNK_SIZE);

  const total = await countVerifiableStrings(
    db,
    opts.modId,
    opts.srcLang,
    opts.targetLang,
    opts.force === true,
  );
  if (total === 0) {
    throw new Error('No strings pending review');
  }

  onEvent?.({ type: 'started', total, dryRun, dbChunkSize });

  let dbPage = 0;

  try {
    const summary = await runModVerifyPipeline(
      db,
      {
        modId: opts.modId,
        srcLang: opts.srcLang,
        targetLang: opts.targetLang,
        modName: opts.modName,
        game: opts.game,
        dryRun,
        autoApproveVerified,
        fixSuspicious,
        force: opts.force,
        dbChunkSize,
        rag: opts.rag,
        knownTotal: total,
      },
      {
        onProgress: (progress) => {
          dbPage = progress.dbPage;
          onEvent?.({
            type: 'progress',
            done: progress.done,
            total,
            approved: progress.approved,
            fixed: progress.fixed,
            suspicious: progress.suspicious,
            incorrect: progress.incorrect,
            errors: progress.errors,
            dbPage,
            issue: progress.issue,
            chunkError: progress.chunkError,
          });
        },
      },
    );

    onEvent?.({ type: 'done', total, ...summary });
    return { total, ...summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logVerify.error('cli verify failed', { modId: opts.modId, error: message });
    onEvent?.({ type: 'error', error: message });
    throw err;
  }
};

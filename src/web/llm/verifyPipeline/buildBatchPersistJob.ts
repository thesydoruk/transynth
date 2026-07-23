import type { LlmVerifyItem } from '../../../llm/verifyTranslate';
import { resolveVerifyFixAction } from '../../../llm/verifySuggestionGuards';
import { logVerify } from '../../../logging/loggers';
import { parseRecordLocation } from '../../../utils/recordLocation';
import type { LlmVerifyIssue } from '../verifyService/queries';
import type { RunModVerifyPipelineOpts, VerifyBatchPersistJob, VerifyStringRow } from './types';

type VerifyResults = Awaited<
  ReturnType<typeof import('../../../llm/verifyTranslate').verifyTranslationsWithLlm>
>;

export const buildBatchPersistJob = (
  llmChunk: VerifyStringRow[],
  results: VerifyResults,
  opts: Pick<RunModVerifyPipelineOpts, 'modId' | 'game' | 'fixSuspicious' | 'dryRun'>,
  fixSuspicious: boolean,
  dryRun: boolean,
  collectIssue?: (issue: LlmVerifyIssue) => void,
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
    collectIssue?.(issue);

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

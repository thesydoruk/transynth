import { isBlockingVerifyResult, type LlmVerifyItem } from '../../../../../src/llm/verifyTranslate';
import { isGenderLeakProvenForRow } from './provenGender';
import { resolveVerifyFixAction } from '../../../../../src/llm/verifySuggestionGuards';
import { logVerify } from '../../../../../src/logging/loggers';
import { parseRecordLocation } from '../../../../../src/utils/recordLocation';
import type { LlmVerifyIssue } from '../queries';
import type { RunModVerifyPipelineOpts, VerifyBatchPersistJob, VerifyStringRow } from './types';

/**
 * How many rewrites a row gets before the pipeline stops trying.
 *
 * Measured on the production corpus: rows that never settle average 17.8
 * rewrites and 11 distinct wordings, cycling back through ones they already
 * had. Past a handful of attempts another rewrite is not converging on
 * anything, so the objection is recorded and the row is left for a person.
 * Only advice is capped this way — a proven defect is always repaired.
 */
const MAX_ADVISORY_REWRITES = 5;

const sameWording = (a: string, b: string): boolean =>
  a.trim().replace(/\s+/g, ' ') === b.trim().replace(/\s+/g, ' ');

type VerifyResults = Awaited<
  ReturnType<typeof import('../../../../../src/llm/verifyTranslate').verifyTranslationsWithLlm>
>;

/**
 * Drop a gender finding that rests on a guess about who narrates a record
 * (see {@link isGenderLeakProvenForRow}). The objection is kept as advice; it
 * just stops counting as proof.
 */
const withoutGuessedGenderDefect = (
  result: VerifyResults[number],
  row: VerifyStringRow,
  grup: string | null,
  game?: string | null,
): VerifyResults[number] => {
  if (!result.defects?.includes('gender_leak')) return result;
  if (isGenderLeakProvenForRow(row, grup, game)) return result;
  return { ...result, defects: result.defects.filter((defect) => defect !== 'gender_leak') };
};

/**
 * @param genderRepairAttempted - Rows the specialist gender pass already saw
 * before the audit in this same run. A leak it left standing then will not
 * yield to the same pass a minute later, so those rows are not sent again.
 */
export const buildBatchPersistJob = (
  llmChunk: VerifyStringRow[],
  results: VerifyResults,
  opts: Pick<RunModVerifyPipelineOpts, 'modId' | 'game' | 'fixSuspicious' | 'dryRun'>,
  fixSuspicious: boolean,
  dryRun: boolean,
  collectIssue?: (issue: LlmVerifyIssue) => void,
  genderRepairAttempted?: ReadonlySet<number>,
): VerifyBatchPersistJob => {
  const rowById = new Map(llmChunk.map((row) => [row.string_id, row]));
  const okStringIds: number[] = [];
  const advisories: VerifyBatchPersistJob['advisories'] = [];
  const genderRepairs: VerifyBatchPersistJob['genderRepairs'] = [];
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

    const graded = withoutGuessedGenderDefect(
      result,
      row,
      parseRecordLocation(row.signature, row.path).grup,
      opts.game,
    );
    const blocking = isBlockingVerifyResult(graded);

    // Advice has a budget; a proven defect does not.
    const exhausted = !blocking && row.rewrite_count >= MAX_ADVISORY_REWRITES;
    const repeatsRejected =
      fixAction.kind === 'apply' &&
      row.prior_texts.some((prior) => sameWording(prior, fixAction.suggestion));
    const effectiveFix: typeof fixAction =
      exhausted || repeatsRejected ? { kind: 'flag_only' } : fixAction;

    if (repeatsRejected) {
      logVerify.debug('verify fix repeats a wording this row already had', {
        modId: opts.modId,
        stringId: result.id,
      });
    }

    const issue: LlmVerifyIssue = {
      advisory: !blocking,
      stringId: result.id,
      source: row.source,
      translation: row.translation,
      signature: row.signature,
      path: row.path,
      edid: row.edid,
      verdict: result.verdict,
      reason: result.reason,
      confidence: result.confidence,
      suggestion: effectiveFix.kind === 'apply' ? effectiveFix.suggestion : result.suggestion,
      fixRejected: effectiveFix.kind === 'reject_fix' ? effectiveFix.message : null,
      rewriteFromSource: effectiveFix.kind === 'rewrite_from_source',
    };

    issues.push(issue);
    collectIssue?.(issue);

    if (!dryRun && effectiveFix.kind === 'apply') {
      fixes.push({
        stringId: result.id,
        text: effectiveFix.suggestion,
        row,
        proven: blocking && (graded.defects?.length ?? 0) > 0,
      });
    } else if (!dryRun && effectiveFix.kind === 'rewrite_from_source') {
      rewrites.push({ item: itemForValidation, row });
    } else if (effectiveFix.kind === 'approve_as_ok') {
      okStringIds.push(result.id);
    } else if (blocking && effectiveFix.kind === 'flag_only') {
      // Proven wrong with no wording offered. Without this the row can be
      // neither repaired nor approved, and simply stays blocked for ever.
      if (
        !dryRun &&
        graded.defects?.includes('gender_leak') &&
        !genderRepairAttempted?.has(result.id)
      ) {
        genderRepairs.push(row);
      }
    } else if (!blocking && effectiveFix.kind === 'flag_only') {
      // Nothing was proven and nothing was rewritten, so the row stands as it
      // is. Keep the objection against it and let it go to review: holding it
      // back for ever on an opinion the next run may not repeat is what left
      // these rows circling.
      advisories.push({ stringId: result.id, message: result.reason });
      okStringIds.push(result.id);
    } else if (!dryRun && effectiveFix.kind === 'reject_fix') {
      logVerify.warn('verify fix skipped — suggestion failed validation', {
        modId: opts.modId,
        stringId: result.id,
        reason: effectiveFix.message,
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

  return {
    okStringIds,
    advisories,
    genderRepairs,
    fixes,
    rewrites,
    issues,
    rowById,
    progressRows,
  };
};

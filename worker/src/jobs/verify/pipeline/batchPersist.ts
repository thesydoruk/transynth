import type { Tx } from '../../../../../src/db';
import { CONFIG } from '../../../../../src/config';
import { rewriteVerifyTranslationsFromSource } from '../../../../../src/llm/verifySourceRewrite';
import { editVerifyFixes, repairProvenGenderLeaks } from './editVerifyFixes';
import { preferBetterTranslations } from '../../../../../src/llm/preferBetterTranslation';
import { parseRecordLocation } from '../../../../../src/utils/recordLocation';
import { logVerify } from '../../../../../src/logging/loggers';
import { Semaphore } from '../../../../../src/utils/concurrency';
import {
  approveVerifiedTranslations,
  upsertTranslation,
} from '../../../../../src/web/data/queries';
import { bulkInsertQAIssues } from '../../../../../src/web/data/queries/qaHelpers';
import type { VerifyBatchPersistJob, RunModVerifyPipelineOpts, VerifyStringRow } from './types';

/** QA issue type for an objection only the model made. */
export const VERIFY_ADVISORY_ISSUE_TYPE = 'llm_review';

export type BatchPersistCounters = {
  done: number;
  approved: number;
  fixed: number;
  suspicious: number;
  incorrect: number;
  errors: number;
};

export type BatchPersistContext = {
  db: Tx;
  opts: Pick<
    RunModVerifyPipelineOpts,
    'modId' | 'srcLang' | 'targetLang' | 'game' | 'modName' | 'signal'
  >;
  dryRun: boolean;
  autoApproveVerified: boolean;
  model: string;
  counters: BatchPersistCounters;
  persistPool: Semaphore;
  persistJobs: Promise<void>[];
  emitProgress: (extra?: Partial<import('./types').VerifyPipelineProgress>) => void;
  logAction: (
    row: VerifyStringRow,
    action: 'approved' | 'fixed' | 'issue',
    detail?: string | null,
  ) => void;
};

export const scheduleBatchPersist = (
  ctx: BatchPersistContext,
  job: VerifyBatchPersistJob,
): void => {
  const { db, opts, dryRun, autoApproveVerified, model, counters, persistPool, persistJobs } = ctx;

  persistJobs.push(
    persistPool.run(async () => {
      const approvedIds = new Set<number>();
      const rewriteConfirmedIds: number[] = [];

      if (!dryRun) {
        if (job.rewrites.length > 0) {
          const rewriteRowById = new Map(job.rewrites.map((entry) => [entry.item.id, entry.row]));
          try {
            const { rewritten, confirmedUnchanged } = await rewriteVerifyTranslationsFromSource({
              items: job.rewrites.map((entry) => entry.item),
              model,
              srcLang: opts.srcLang,
              targetLang: opts.targetLang,
              game: opts.game,
              modName: opts.modName,
              signal: opts.signal,
            });
            rewriteConfirmedIds.push(...confirmedUnchanged);
            for (const row of rewritten) {
              const sourceRow = rewriteRowById.get(row.id);
              if (!sourceRow) continue;
              try {
                await upsertTranslation(db, row.id, row.text, 'auto', opts.targetLang);
                counters.fixed++;
                ctx.logAction(sourceRow, 'fixed', row.text);
              } catch (err) {
                counters.errors++;
                logVerify.warn('verify source rewrite persist failed', {
                  modId: opts.modId,
                  stringId: row.id,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
            const handledRewriteIds = new Set([
              ...rewritten.map((row) => row.id),
              ...confirmedUnchanged,
            ]);
            for (const { item } of job.rewrites) {
              if (handledRewriteIds.has(item.id)) continue;
              logVerify.warn('verify source rewrite produced no valid translation', {
                modId: opts.modId,
                stringId: item.id,
              });
            }
          } catch (err) {
            counters.errors += job.rewrites.length;
            logVerify.warn('verify source rewrite batch failed', {
              modId: opts.modId,
              stringIds: job.rewrites.map((entry) => entry.item.id),
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // A fix goes through the same editor passes translate ends with. The
        // source rewrites above already ran them inside translateStrings.
        const editedFixes = await editVerifyFixes(job.fixes, {
          model,
          srcLang: opts.srcLang,
          targetLang: opts.targetLang,
          game: opts.game,
          modName: opts.modName,
          ...(opts.signal ? { signal: opts.signal } : {}),
        });

        // Last gate: the rewrite has to beat what is already there. Judging a
        // line on its own does not reproduce, so the pass that decides whether
        // to write is a comparison, and a tie leaves the row alone.
        const candidates = job.fixes.map((fix) => ({
          item: {
            id: fix.stringId,
            source: fix.row.source,
            translation: fix.row.translation,
            ...parseRecordLocation(fix.row.signature, fix.row.path),
            edid: fix.row.edid,
            context: fix.row.context,
          },
          candidate: editedFixes.get(fix.stringId) ?? fix.text,
        }));
        const preferred = await preferBetterTranslations(candidates, {
          model,
          srcLang: opts.srcLang,
          targetLang: opts.targetLang,
          game: opts.game,
          ...(opts.signal ? { signal: opts.signal } : {}),
        });

        for (const fix of job.fixes) {
          if (!preferred.has(fix.stringId)) {
            ctx.logAction(fix.row, 'issue', 'Rewrite did not beat the current translation.');
            continue;
          }
          const text = editedFixes.get(fix.stringId) ?? fix.text;
          try {
            await upsertTranslation(db, fix.stringId, text, 'auto', opts.targetLang);
            counters.fixed++;
            ctx.logAction(fix.row, 'fixed', text);
          } catch (err) {
            counters.errors++;
            logVerify.warn('verify auto-fix failed', {
              modId: opts.modId,
              stringId: fix.stringId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // A proven gender leak the auditor would not put a wording to. The
        // specialist pass is given the line as it stands; a result that still
        // leaks is dropped, so a row is never "repaired" into the same fault.
        if (job.genderRepairs.length > 0) {
          const genderFixed = await repairProvenGenderLeaks(job.genderRepairs, {
            model,
            srcLang: opts.srcLang,
            targetLang: opts.targetLang,
            game: opts.game,
            modName: opts.modName,
            ...(opts.signal ? { signal: opts.signal } : {}),
          });
          for (const row of job.genderRepairs) {
            const text = genderFixed.get(row.string_id);
            if (!text) continue;
            try {
              await upsertTranslation(db, row.string_id, text, 'auto', opts.targetLang);
              counters.fixed++;
              ctx.logAction(row, 'fixed', text);
            } catch (err) {
              counters.errors++;
              logVerify.warn('verify gender repair persist failed', {
                modId: opts.modId,
                stringId: row.string_id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }

        // The model's unaided objections outlive the job: they belong on the row
        // where a translator can see and act on them, not in a job snapshot that
        // is thrown away when the run ends.
        if (job.advisories.length > 0) {
          try {
            await bulkInsertQAIssues(
              db,
              job.advisories.map((advisory) => ({
                stringId: advisory.stringId,
                translationId: null,
                targetLang: opts.targetLang,
                issueType: VERIFY_ADVISORY_ISSUE_TYPE,
                severity: 'warning',
                message: advisory.message,
              })),
            );
          } catch (err) {
            logVerify.warn('verify advisory persist failed', {
              modId: opts.modId,
              count: job.advisories.length,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        const idsToApprove = [...job.okStringIds, ...rewriteConfirmedIds];
        if (autoApproveVerified && idsToApprove.length > 0) {
          try {
            const promoted = await approveVerifiedTranslations(db, idsToApprove, opts.targetLang);
            counters.approved += promoted;
            for (const id of idsToApprove) approvedIds.add(id);
          } catch (err) {
            counters.errors += idsToApprove.length;
            logVerify.warn('verify auto-approve failed for chunk', {
              modId: opts.modId,
              error: err instanceof Error ? err.message : String(err),
              stringIds: idsToApprove,
            });
          }
        }
      }

      for (const entry of job.progressRows) {
        counters.done++;
        if (entry.verdictCounts?.suspicious) counters.suspicious++;
        if (entry.verdictCounts?.incorrect) counters.incorrect++;
        if (entry.row && approvedIds.has(entry.result.id)) {
          ctx.logAction(entry.row, 'approved');
          ctx.emitProgress();
          continue;
        }
        if (entry.result.verdict === 'ok') {
          ctx.emitProgress();
          continue;
        }
        if (entry.row) {
          if (autoApproveVerified) {
            ctx.logAction(entry.row, 'issue', entry.result.reason);
            ctx.emitProgress();
            continue;
          }
          ctx.emitProgress({ issue: entry.issue });
          continue;
        }
        ctx.emitProgress();
      }
    }),
  );
};

export const drainPersistJobs = async (persistJobs: Promise<void>[]): Promise<void> => {
  if (persistJobs.length === 0) return;
  logVerify.debug('draining verify persist queue', { jobs: persistJobs.length });
  await Promise.all(persistJobs);
};

export const createPersistPool = (): { pool: Semaphore; jobs: Promise<void>[] } => {
  const persistConcurrency = Math.max(2, Math.min(8, CONFIG.dbPoolMax));
  return { pool: new Semaphore(persistConcurrency), jobs: [] };
};

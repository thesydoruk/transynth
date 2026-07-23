import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { rewriteVerifyTranslationsFromSource } from '../../../llm/verifySourceRewrite';
import { logVerify } from '../../../logging/loggers';
import { Semaphore } from '../../../utils/concurrency';
import { approveVerifiedTranslations, upsertTranslation } from '../../data/queries';
import type { VerifyBatchPersistJob, RunModVerifyPipelineOpts, VerifyStringRow } from './types';

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

        for (const fix of job.fixes) {
          try {
            await upsertTranslation(db, fix.stringId, fix.text, 'auto', opts.targetLang);
            counters.fixed++;
            ctx.logAction(fix.row, 'fixed', fix.text);
          } catch (err) {
            counters.errors++;
            logVerify.warn('verify auto-fix failed', {
              modId: opts.modId,
              stringId: fix.stringId,
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

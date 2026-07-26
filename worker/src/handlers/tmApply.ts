/**
 * Apply translation memory matches to a mod.
 *
 * Progress is counters only (applied / skipped) — no row list to accumulate
 * into the snapshot beyond what the service puts in its final snapshot.
 */
import { runTmApplyJob } from '../../../src/web/services/tmApplyJobService';
import type { JobHandler } from '../types';
import { runTrackedJob } from '../runTrackedJob';

export type TmApplyJobParams = {
  srcLang: string;
  targetLang: string;
};

export const tmApplyHandler: JobHandler = (db, ctx) => {
  const params = ctx.data.params as TmApplyJobParams;
  const modId = ctx.data.modId!;
  return runTrackedJob(ctx, (onEvent) =>
    runTmApplyJob(
      db,
      { jobId: ctx.jobId, modId, ...params, isCancelled: ctx.isCancelled },
      onEvent,
    ),
  );
};

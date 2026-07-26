/**
 * Copy translations from an imported mod onto a target mod.
 *
 * `ctx.data.modId` is the *target*; the source is `params.fromModId`.
 */
import { runApplyImportedJob } from '../../../src/web/import/applyImportedJobService';
import type { JobHandler } from '../types';
import { runTrackedJob } from '../runTrackedJob';

export type ApplyImportedJobParams = {
  fromModId: number;
  importedLang: string;
  srcLang: string;
  targetLang: string;
};

export const applyImportedHandler: JobHandler = (db, ctx) => {
  const params = ctx.data.params as ApplyImportedJobParams;
  const targetModId = ctx.data.modId!;
  return runTrackedJob(ctx, (onEvent) =>
    runApplyImportedJob(
      db,
      {
        jobId: ctx.jobId,
        targetModId,
        ...params,
        isCancelled: ctx.isCancelled,
      },
      onEvent,
    ),
  );
};

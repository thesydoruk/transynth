/**
 * Infer speaker gender for voice / grammar tagging on a mod.
 *
 * Thin wrapper: the service's own progress events and final snapshot are
 * enough for status GETs — no extra accumulation here.
 */
import { runLlmGenderDetectJob } from '../../../src/web/llm/genderDetectService';
import type { JobHandler } from '../types';
import { runTrackedJob } from '../runTrackedJob';

export type GenderDetectJobParams = {
  srcLang: string;
  modName?: string | null;
  game?: string | null;
  useLlm?: boolean;
  force?: boolean;
};

export const genderDetectHandler: JobHandler = (db, ctx) => {
  const params = ctx.data.params as GenderDetectJobParams;
  const modId = ctx.data.modId!;
  return runTrackedJob(ctx, (onEvent) =>
    runLlmGenderDetectJob(
      db,
      {
        jobId: ctx.jobId,
        modId,
        ...params,
        signal: ctx.signal,
        isCancelled: ctx.isCancelled,
      },
      onEvent,
    ),
  );
};

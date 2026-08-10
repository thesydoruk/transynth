import { runLlmStressPlaceJob } from './runJob';
import type { StressPlaceJobParams } from './types';
import type { JobHandler } from '../../types';
import { runTrackedJob } from '../../runTrackedJob';

export const stressPlaceHandler: JobHandler = (db, ctx) => {
  const params = ctx.data.params as StressPlaceJobParams;
  const modId = ctx.data.modId!;
  return runTrackedJob(ctx, (onEvent) =>
    runLlmStressPlaceJob(
      db,
      {
        jobId: ctx.jobId,
        modId,
        srcLang: params.srcLang,
        targetLang: params.targetLang,
        scope: params.scope,
        speakerKey: params.speakerKey,
        force: params.force,
        signal: ctx.signal,
        isCancelled: ctx.isCancelled,
      },
      onEvent,
    ),
  );
};

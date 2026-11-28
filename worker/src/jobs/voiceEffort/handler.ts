/**
 * Measure the vocal effort of a mod's original takes (`voice-effort`).
 *
 * CPU work (ffmpeg decodes), so it runs on the `cpu` queue and does not hold
 * the TTS queue while a base game's hundred thousand takes are measured.
 */
import { runTrackedJob } from '../../runTrackedJob';
import type { JobHandler } from '../../types';
import { runVoiceEffortJob } from './runJob';

export type VoiceEffortJobParams = {
  game: string;
  modName?: string | null;
  /** Takes decoded at once; the analysis defaults to four. */
  workers?: number;
};

export const voiceEffortHandler: JobHandler = async (db, ctx) => {
  const params = ctx.data.params as VoiceEffortJobParams;
  return runTrackedJob(ctx, (onEvent) =>
    runVoiceEffortJob(
      db,
      {
        jobId: ctx.jobId,
        modId: ctx.data.modId!,
        workers: params.workers,
        isCancelled: ctx.isCancelled,
      },
      onEvent,
    ),
  );
};

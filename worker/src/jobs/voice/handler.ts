/**
 * Generate TTS voice files for a mod.
 *
 * Refreshes the TTS pool from `project_settings` before each run so mid-life
 * setting changes (concurrency / endpoint) take effect without a worker restart.
 */
import type { ModVoiceGenerateScope, VoiceResynthJobInput } from '../../../../src/voice';
import { syncTtsPoolFromProjectSettings } from '../../../../src/voice/voiceProjectSettings';
import { getAllProjectSettings } from '../../../../src/web/services/projectSettings';
import { runModVoiceGenerateJob } from './runJob';
import type { JobHandler } from '../../types';
import { runTrackedJob } from '../../runTrackedJob';

/**
 * The `low-similarity` fields ride along in the params so a resumed job keeps
 * them; `runId` is set on resume to the first job's id (see `recoverVoiceJobs`).
 */
export type VoiceGenerateJobParams = VoiceResynthJobInput & {
  srcLang: string;
  targetLang: string;
  game: string;
  modName?: string | null;
  scope?: ModVoiceGenerateScope;
  /** Wipe existing localized voice once, then synthesize as `missing`. */
  resetVoice?: boolean;
  /** When set, synthesize only this NPC voice folder. */
  speakerKey?: string;
};

export const voiceGenerateHandler: JobHandler = async (db, ctx) => {
  const params = ctx.data.params as VoiceGenerateJobParams;
  const modId = ctx.data.modId!;
  syncTtsPoolFromProjectSettings(await getAllProjectSettings(db));
  return runTrackedJob(ctx, (onEvent) =>
    runModVoiceGenerateJob(
      db,
      { jobId: ctx.jobId, modId, ...params, isCancelled: ctx.isCancelled, signal: ctx.signal },
      onEvent,
    ),
  );
};

/**
 * Separate and transcribe one cutscene video (`video-separate`).
 *
 * Runs on the `separate` queue: one job at a time against audio-intel's batch
 * lane. Progress is the lane's stage name; the result is the phrase count and
 * the Video mod the phrases went into.
 */
import { separateVideo } from '../../../../src/video/separate';
import { runTrackedJob } from '../../runTrackedJob';
import type { JobEvent, JobHandler } from '../../types';

export type VideoSeparateJobParams = {
  videoId: number;
  srcLang: string;
  tgtLang: string;
};

export const videoSeparateHandler: JobHandler = (db, ctx) => {
  const params = ctx.data.params as VideoSeparateJobParams;
  return runTrackedJob(ctx, async (onEvent: (event: JobEvent) => void) => {
    onEvent({ type: 'started', videoId: params.videoId });
    try {
      const outcome = await separateVideo(db, {
        ...params,
        signal: ctx.signal,
        onStage: (stage) => {
          onEvent({ type: 'progress', videoId: params.videoId, stage });
          ctx.mergeSnapshot({ stage });
        },
      });
      onEvent({ type: 'done', videoId: params.videoId, ...outcome });
      return { status: 'completed', done: 1, total: 1, error: null, ...outcome };
    } catch (err) {
      if (ctx.isCancelled()) {
        onEvent({ type: 'cancelled', videoId: params.videoId });
        return { status: 'cancelled', done: 0, total: 1, error: null };
      }
      const error = err instanceof Error ? err.message : String(err);
      onEvent({ type: 'error', videoId: params.videoId, error });
      return { status: 'failed', done: 0, total: 1, error };
    }
  });
};

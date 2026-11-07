/**
 * Write one cutscene video's dub into the video (`video-pack`): the asset's
 * copy of the file goes through bethesda-tools' BinkMix. Runs on the `cpu`
 * queue and waits for a healthy `tools` host.
 */
import { packVideo } from '../../../../src/video/pack';
import { runTrackedJob } from '../../runTrackedJob';
import type { JobEvent, JobHandler } from '../../types';

export type VideoPackJobParams = { videoId: number };

export const videoPackHandler: JobHandler = (db, ctx) => {
  const params = ctx.data.params as VideoPackJobParams;
  return runTrackedJob(ctx, async (onEvent: (event: JobEvent) => void) => {
    onEvent({ type: 'started', videoId: params.videoId });
    ctx.mergeSnapshot({ stage: 'mixing' });
    try {
      const outcome = await packVideo(db, { videoId: params.videoId, signal: ctx.signal });
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

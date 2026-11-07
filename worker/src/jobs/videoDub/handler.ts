/**
 * Dub one cutscene video (`video-dub`): takes for its translated phrases,
 * fitted to their slots and mixed over the background. Runs on the `tts`
 * queue like a voice job; progress is takes done / takes planned. A finished
 * dub is handed straight on to `video-pack`, which writes it into the video.
 */
import { dubVideo, parseDubScope } from '../../../../src/video/dub';
import { startBackgroundJob } from '../../api/startBackgroundJob';
import { runTrackedJob } from '../../runTrackedJob';
import type { JobEvent, JobHandler } from '../../types';

export type VideoDubJobParams = {
  videoId: number;
  tgtLang: string;
  scope: string;
};

export const videoDubHandler: JobHandler = (db, ctx) => {
  const params = ctx.data.params as VideoDubJobParams;
  const scope = parseDubScope(params.scope) ?? { kind: 'changed' as const };
  return runTrackedJob(ctx, async (onEvent: (event: JobEvent) => void) => {
    onEvent({ type: 'started', videoId: params.videoId });
    let last = { done: 0, total: 0 };
    try {
      const outcome = await dubVideo(db, {
        videoId: params.videoId,
        tgtLang: params.tgtLang,
        scope,
        signal: ctx.signal,
        onProgress: (done, total, stage) => {
          last = { done, total };
          onEvent({ type: 'progress', videoId: params.videoId, done, total, stage });
          ctx.mergeSnapshot({ stage, done, total });
        },
      });
      const packJobId = await startBackgroundJob(
        { kind: 'video-pack', modId: ctx.data.modId, params: { videoId: params.videoId } },
        { videoId: params.videoId, stage: 'queued' },
      );
      onEvent({ type: 'done', videoId: params.videoId, packJobId, ...outcome });
      return {
        status: 'completed',
        done: last.total,
        total: last.total,
        error: null,
        packJobId,
        ...outcome,
      };
    } catch (err) {
      if (ctx.isCancelled()) {
        onEvent({ type: 'cancelled', videoId: params.videoId });
        return { status: 'cancelled', ...last, error: null };
      }
      const error = err instanceof Error ? err.message : String(err);
      onEvent({ type: 'error', videoId: params.videoId, error });
      return { status: 'failed', ...last, error };
    }
  });
};

/**
 * Hand the server the video files it registered from the agent's manifests:
 * the heartbeat lists what is missing, the agent finds each file by its hash
 * in its own inventory and uploads it as it is. The server reads the tracks
 * and decodes the narration itself; nothing is installed here for that.
 */
import type { VideoUploadTask } from '../types';

export type VideoUploadApi = {
  putVideoFile: (modId: number, videoId: number, filePath: string) => Promise<void>;
};

export type UploadVideoFilesOptions = {
  tasks: readonly VideoUploadTask[];
  /** The video file with this hash, from the agent's inventory; null when it is not there. */
  locate: (fingerprint: string) => string | null;
  api: VideoUploadApi;
  log?: (line: string) => void;
};

export type VideoUploadOutcome = { uploaded: number; skipped: number };

export const uploadVideoFiles = async (
  opts: UploadVideoFilesOptions,
): Promise<VideoUploadOutcome> => {
  const outcome: VideoUploadOutcome = { uploaded: 0, skipped: 0 };
  for (const task of opts.tasks) {
    const absPath = opts.locate(task.fingerprint);
    if (!absPath) {
      opts.log?.(`video ${task.fileName}: not in the inventory any more, skipped`);
      outcome.skipped += 1;
      continue;
    }
    await opts.api.putVideoFile(task.modId, task.videoId, absPath);
    outcome.uploaded += 1;
    opts.log?.(`video ${task.fileName}: uploaded as #${task.videoId}`);
  }
  return outcome;
};

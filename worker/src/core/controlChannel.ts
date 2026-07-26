/**
 * Abort / pause signals for *active* jobs.
 *
 * BullMQ can remove a still-queued job, but has no built-in way to interrupt
 * one that is already running. The API publishes `{ jobId, action }` on this
 * channel; the worker that holds the job aborts its AbortSignal (cancel) or
 * flips the import pause flag (pause).
 */
import { logJobs } from '../../../src/logging/loggers';
import { createRedisConnection, getSharedRedis } from './connection';

const CONTROL_CHANNEL = 'transynth:jobs:control';

export type JobControlAction = 'cancel' | 'pause';

export const publishJobControl = async (jobId: number, action: JobControlAction): Promise<void> => {
  try {
    await getSharedRedis().publish(CONTROL_CHANNEL, JSON.stringify({ jobId, action }));
  } catch (err) {
    logJobs.warn(
      `control publish (${action} #${jobId}) failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
};

/**
 * Worker-side subscription. Uses its own Redis connection (subscribers cannot
 * share a client with other commands). Returns an unsubscribe / quit function.
 */
export const subscribeJobControl = async (
  onControl: (jobId: number, action: JobControlAction) => void,
): Promise<() => Promise<void>> => {
  const client = createRedisConnection('control-subscriber');
  client.on('message', (_channel, message) => {
    try {
      const { jobId, action } = JSON.parse(message) as { jobId: number; action: JobControlAction };
      if (Number.isInteger(jobId) && (action === 'cancel' || action === 'pause')) {
        onControl(jobId, action);
      }
    } catch {
      logJobs.debug('malformed control message ignored');
    }
  });
  await client.subscribe(CONTROL_CHANNEL);
  return async () => {
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  };
};

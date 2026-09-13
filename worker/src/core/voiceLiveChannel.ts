/**
 * Redis fan-out for per-line voice synthesis events.
 *
 * Publish is shared (same client as snapshots). Subscribe needs its own
 * connection — Redis forbids other commands on a subscriber.
 */
import {
  parseVoiceLiveEvent,
  setVoiceLiveSink,
  VOICE_LIVE_CHANNEL,
  type VoiceLiveLineEvent,
} from '../../../src/voice/voiceLiveEvents';
import { logJobs } from '../../../src/logging/loggers';
import { createRedisConnection, getSharedRedis } from './connection';

export const publishVoiceLiveEvent = async (event: VoiceLiveLineEvent): Promise<void> => {
  try {
    await getSharedRedis().publish(VOICE_LIVE_CHANNEL, JSON.stringify(event));
  } catch (err) {
    logJobs.warn(`voice-live publish failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

/** Wire process-local {@link setVoiceLiveSink} to Redis. Call once per process. */
export const installVoiceLivePublisher = (): void => {
  setVoiceLiveSink((event) => {
    void publishVoiceLiveEvent(event);
  });
};

/**
 * Dedicated subscriber. Returns an unsubscribe / quit function.
 */
export const subscribeVoiceLive = async (
  onEvent: (event: VoiceLiveLineEvent) => void,
): Promise<() => Promise<void>> => {
  const client = createRedisConnection('voice-live-sub');
  client.on('message', (_channel, message) => {
    try {
      const event = parseVoiceLiveEvent(JSON.parse(message) as unknown);
      if (event) onEvent(event);
    } catch {
      logJobs.debug('malformed voice-live message ignored');
    }
  });
  await client.subscribe(VOICE_LIVE_CHANNEL);
  return async () => {
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  };
};

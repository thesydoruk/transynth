/**
 * In-process fan-out from Redis voice-live events to open SSE clients.
 */
import { openSseStream } from '../../../worker/src/api/sse';
import { subscribeVoiceLive } from '../../../worker/src/core/voiceLiveChannel';
import { log } from '../../logger';
import type { FastifyReply, FastifyRequest } from 'fastify';

const HEARTBEAT_MS = 20_000;

type Listener = {
  modId: number;
  send: (data: object) => void;
};

const listeners = new Set<Listener>();
let unsubscribe: (() => Promise<void>) | null = null;
let starting: Promise<void> | null = null;

const ensureSubscriber = async (): Promise<void> => {
  if (unsubscribe) return;
  if (starting) {
    await starting;
    return;
  }
  starting = (async () => {
    unsubscribe = await subscribeVoiceLive((event) => {
      for (const listener of listeners) {
        if (listener.modId === event.modId) listener.send(event);
      }
    });
  })()
    .catch((err) => {
      unsubscribe = null;
      log.warn(
        `voice-live Redis subscribe failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    })
    .finally(() => {
      starting = null;
    });
  await starting;
};

/** Keep an SSE stream open and forward this mod's per-line synthesis events. */
export const attachVoiceLiveSse = (
  req: FastifyRequest,
  reply: FastifyReply,
  modId: number,
): void => {
  const sse = openSseStream(req, reply);
  const listener: Listener = { modId, send: sse.send };
  listeners.add(listener);
  const heartbeat = setInterval(() => sse.send({ type: 'ping' }), HEARTBEAT_MS);
  heartbeat.unref?.();
  sse.onClose(() => {
    clearInterval(heartbeat);
    listeners.delete(listener);
  });
  void ensureSubscriber();
};

export const closeVoiceLiveHub = async (): Promise<void> => {
  const quit = unsubscribe;
  unsubscribe = null;
  listeners.clear();
  if (quit) await quit();
};

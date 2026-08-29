/**
 * Redis connections for BullMQ, snapshots and the control channel.
 *
 * A broker outage must degrade the UI, not crash the process — connection
 * errors are throttled in the log and never rethrown from event handlers.
 *
 * BullMQ needs `maxRetriesPerRequest: null` (it uses blocking Redis commands).
 * QueueEvents and the worker each get their own connection; the shared client
 * is for enqueue / snapshot / publish only.
 */
import { Redis } from 'ioredis';
import { CONFIG } from '../../../src/config';
import { logJobs } from '../../../src/logging/loggers';

/** Errors fire on every reconnect attempt; keep the log to ≤1 line / minute. */
const attachErrorLogging = (client: Redis, role: string): void => {
  let lastLoggedAt = 0;
  client.on('error', (err: Error) => {
    const now = Date.now();
    if (now - lastLoggedAt < 60_000) return;
    lastLoggedAt = now;
    logJobs.warn(`Redis (${role}) unavailable: ${err.message}`);
  });
};

/** Fresh connection for a dedicated role (worker, QueueEvents, control sub). */
export const createRedisConnection = (role: string): Redis => {
  const client = new Redis(CONFIG.redisUrl, { maxRetriesPerRequest: null });
  attachErrorLogging(client, role);
  return client;
};

let shared: Redis | null = null;

/** Lazy singleton for enqueue, snapshot R/W and control publishes. */
export const getSharedRedis = (): Redis => {
  if (!shared) shared = createRedisConnection('shared');
  return shared;
};

export const closeSharedRedis = async (): Promise<void> => {
  if (!shared) return;
  const client = shared;
  shared = null;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
};

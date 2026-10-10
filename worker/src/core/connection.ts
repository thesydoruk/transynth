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
/** Set by the shared client's `error`, cleared by its next `ready`. */
let sharedDown = false;

/** Lazy singleton for enqueue, snapshot R/W and control publishes. */
export const getSharedRedis = (): Redis => {
  if (!shared) {
    const client = createRedisConnection('shared');
    client.on('ready', () => {
      sharedDown = false;
    });
    client.on('error', () => {
      sharedDown = true;
    });
    shared = client;
  }
  return shared;
};

export const closeSharedRedis = async (): Promise<void> => {
  if (!shared) return;
  const client = shared;
  shared = null;
  sharedDown = false;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
};

/** The shared Redis is down or did not answer in time — callers map it to 503. */
export class QueueUnavailableError extends Error {
  constructor(message = 'Job queue unavailable') {
    super(message);
    this.name = 'QueueUnavailableError';
  }
}

const waitForReady = (client: Redis, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (client.status === 'ready') return resolve();
    const done = (err?: Error) => {
      client.off('ready', onReady);
      client.off('error', onError);
      signal.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve();
    };
    const onReady = () => done();
    const onError = (err: Error) =>
      done(
        new QueueUnavailableError(
          err.message ? `Job queue unavailable: ${err.message}` : undefined,
        ),
      );
    const onAbort = () => done(new QueueUnavailableError());
    client.once('ready', onReady);
    client.once('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
  });

/**
 * Run a request-path read against the shared Redis under a deadline.
 *
 * The shared client queues commands while offline and never gives up on them
 * (`maxRetriesPerRequest: null`), so a bare await during an outage never
 * settles. A known outage fails at once without queueing anything; otherwise
 * the work waits for `ready` and must finish within `timeoutMs`.
 */
export const withSharedRedis = async <T>(work: () => Promise<T>, timeoutMs = 3_000): Promise<T> => {
  const client = getSharedRedis();
  if (sharedDown && client.status !== 'ready') throw new QueueUnavailableError();

  const deadline = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      deadline.abort();
      reject(new QueueUnavailableError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([waitForReady(client, deadline.signal).then(work), expired]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Demand a job signals itself: `transynth:fleet:want:<kind>`.
 *
 * Queue-level demand (`demand.ts`) only knows what a job *kind* declares, and some kinds
 * reach a service as an extra: a Disco voice job or import transcribes with audio-intel,
 * a Fallout job does not. While such a job waits for the service it writes this key with
 * a short TTL and refreshes it on every probe, so the controller brings the service up
 * without the queue declaring it, and the want expires by itself once the job moves on.
 */
import type Redis from 'ioredis';
import { SERVICE_KINDS, type ServiceKind } from '../services/kinds';

const WANT_PREFIX = 'transynth:fleet:want:';

/** Keep a want alive this long after the last refresh (two probe intervals or so). */
const WANT_TTL_SEC = 90;

export const signalServiceWant = async (
  redis: Redis,
  kind: ServiceKind,
  ttlSec: number = WANT_TTL_SEC,
): Promise<void> => {
  await redis.set(`${WANT_PREFIX}${kind}`, '1', 'EX', Math.max(1, ttlSec));
};

/** Kinds some job is waiting for right now. */
export const readServiceWants = async (redis: Redis): Promise<ServiceKind[]> => {
  const values = await redis.mget(...SERVICE_KINDS.map((kind) => `${WANT_PREFIX}${kind}`));
  return SERVICE_KINDS.filter((_, i) => values[i] != null);
};

/**
 * How the controller process and the API talk: a few Redis keys.
 *
 * The controller publishes its snapshot every tick (with a TTL, so a dead controller
 * shows as offline), and reads operator overrides the API writes: `start` holds a
 * service up as if it were in demand, `stop` takes it down and keeps it down. An
 * override expires after an hour, which is the "I just want to try it" horizon.
 */
import type { Redis } from 'ioredis';
import type { FleetSnapshot } from './controller';

const SNAPSHOT_KEY = 'transynth:fleet:snapshot';
const OVERRIDE_PREFIX = 'transynth:fleet:override:';
const OVERRIDE_TTL_SEC = 3600;

export type FleetOverride = 'start' | 'stop';

export const publishFleetSnapshot = async (
  redis: Redis,
  snapshot: FleetSnapshot,
  ttlSec: number,
): Promise<void> => {
  await redis.set(SNAPSHOT_KEY, JSON.stringify(snapshot), 'EX', Math.max(30, ttlSec));
};

export const readFleetSnapshot = async (redis: Redis): Promise<FleetSnapshot | null> => {
  const raw = await redis.get(SNAPSHOT_KEY);
  return raw ? (JSON.parse(raw) as FleetSnapshot) : null;
};

export const setFleetOverride = async (
  redis: Redis,
  service: string,
  override: FleetOverride | null,
): Promise<void> => {
  const key = `${OVERRIDE_PREFIX}${service}`;
  if (override) await redis.set(key, override, 'EX', OVERRIDE_TTL_SEC);
  else await redis.del(key);
};

export const readFleetOverrides = async (
  redis: Redis,
  services: readonly string[],
): Promise<Record<string, FleetOverride>> => {
  if (services.length === 0) return {};
  const values = await redis.mget(...services.map((s) => `${OVERRIDE_PREFIX}${s}`));
  const out: Record<string, FleetOverride> = {};
  services.forEach((name, i) => {
    const v = values[i];
    if (v === 'start' || v === 'stop') out[name] = v;
  });
  return out;
};

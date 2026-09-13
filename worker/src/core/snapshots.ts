/**
 * Job snapshots in Redis — catch-up state for status GETs and reopened modals.
 *
 * The worker refreshes a snapshot while a job runs (and once at finish).
 * The live SSE stream carries every event; the snapshot only keeps a capped
 * tail of large arrays (rows, issues) so Redis stays small.
 *
 * Failures to read/write are logged at debug and swallowed — a missing
 * snapshot just means the modal shows empty until the next flush.
 */
import { CONFIG } from '../../../src/config';
import { logJobs } from '../../../src/logging/loggers';
import type { JobSnapshot } from '../types';
import { getSharedRedis } from './connection';

const snapshotKey = (jobId: number): string => `transynth:job:${jobId}:snapshot`;

/** Keep only the last N rows of each array field (see JOB_SNAPSHOT_MAX_ROWS). */
const capArrays = (data: Record<string, unknown>): Record<string, unknown> => {
  const limit = CONFIG.jobSnapshotMaxRows;
  const capped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    capped[key] = Array.isArray(value) && value.length > limit ? value.slice(-limit) : value;
  }
  return capped;
};

export const isTerminalSnapshotStatus = (status: JobSnapshot['status']): boolean =>
  status === 'completed' || status === 'cancelled' || status === 'failed';

const cancelledKey = (jobId: number): string => `transynth:job:${jobId}:cancelled`;

/** Longer than the snapshot TTL so a hung cancelled job cannot 409-block after expiry. */
const CANCEL_FLAG_TTL_SEC = 7 * 24 * 3600;

/**
 * GET+SET in one Redis eval so a progress flush cannot overwrite cancelled/failed
 * with `running` (the previous JS read-then-write raced with Stop).
 */
const WRITE_SNAPSHOT_LUA = `
local key = KEYS[1]
local payload = ARGV[1]
local ttl = tonumber(ARGV[2])
local newStatus = ARGV[3]
if newStatus == 'running' then
  local existing = redis.call('GET', key)
  if existing then
    local ok, data = pcall(cjson.decode, existing)
    if ok and type(data) == 'table' then
      local status = data.status
      if status == 'cancelled' or status == 'completed' or status == 'failed' then
        return 0
      end
    end
  end
end
redis.call('SET', key, payload, 'EX', ttl)
return 1
`;

export const markJobCancelled = async (jobId: number): Promise<void> => {
  try {
    await getSharedRedis().set(cancelledKey(jobId), '1', 'EX', CANCEL_FLAG_TTL_SEC);
  } catch (err) {
    logJobs.debug(`cancel flag write failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const isJobMarkedCancelled = async (jobId: number): Promise<boolean> => {
  try {
    return (await getSharedRedis().get(cancelledKey(jobId))) === '1';
  } catch (err) {
    logJobs.debug(`cancel flag read failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
};

export const writeJobSnapshot = async (snapshot: JobSnapshot): Promise<void> => {
  try {
    const redis = getSharedRedis();
    const wrote = await redis.eval(
      WRITE_SNAPSHOT_LUA,
      1,
      snapshotKey(snapshot.jobId),
      JSON.stringify({ ...snapshot, data: capArrays(snapshot.data) }),
      String(CONFIG.jobSnapshotTtlSec),
      snapshot.status,
    );
    if (wrote === 1 && snapshot.status === 'cancelled') {
      await markJobCancelled(snapshot.jobId);
    }
  } catch (err) {
    logJobs.debug(`snapshot write failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export const readJobSnapshot = async (jobId: number): Promise<JobSnapshot | null> => {
  try {
    const raw = await getSharedRedis().get(snapshotKey(jobId));
    return raw ? (JSON.parse(raw) as JobSnapshot) : null;
  } catch (err) {
    logJobs.debug(`snapshot read failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
};

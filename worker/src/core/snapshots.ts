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

export const writeJobSnapshot = async (snapshot: JobSnapshot): Promise<void> => {
  try {
    await getSharedRedis().set(
      snapshotKey(snapshot.jobId),
      JSON.stringify({ ...snapshot, data: capArrays(snapshot.data) }),
      'EX',
      CONFIG.jobSnapshotTtlSec,
    );
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

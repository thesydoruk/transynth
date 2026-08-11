/**
 * `GET /api/ai-jobs/active` — mod-scoped AI jobs currently queued or running.
 *
 * Maps BullMQ kinds onto the compact UI labels (`translate` / `verify` / …)
 * and merges live counters from the Redis snapshot when available.
 */
import { fromBullJobId, listUnfinishedJobs } from '../core/queue';
import { readJobSnapshot } from '../core/snapshots';
import type { JobKind, JobSnapshotStatus } from '../types';
import type { Job } from 'bullmq';
import type { JobData } from '../types';

const TERMINAL_SNAPSHOT: ReadonlySet<JobSnapshotStatus> = new Set([
  'completed',
  'cancelled',
  'failed',
]);

/** Drop queue rows left behind after the worker already wrote a terminal snapshot. */
const cleanupZombieQueueJob = async (job: Job<JobData>): Promise<void> => {
  try {
    const state = await job.getState();
    if (
      state === 'waiting' ||
      state === 'delayed' ||
      state === 'prioritized' ||
      state === 'waiting-children'
    ) {
      await job.remove();
    }
  } catch {
    /* best effort — UI already hides the job */
  }
};

export type ModAiJobKind = 'translate' | 'verify' | 'skip-detect' | 'gender-detect' | 'voice';
export type ModTranslateMode = 'tm' | 'llm';

export type ActiveModAiJob = {
  jobId: number;
  modId: number;
  kind: ModAiJobKind;
  done: number;
  total: number;
  status: 'running';
  translateMode?: ModTranslateMode;
  /** Present for character-scoped voice jobs. */
  speakerKey?: string | null;
};

/** Queue kinds that appear on the AI-jobs dashboard (imports are separate). */
const UI_KIND: Partial<Record<JobKind, { kind: ModAiJobKind; translateMode?: ModTranslateMode }>> =
  {
    'llm-translate': { kind: 'translate', translateMode: 'llm' },
    'tm-apply': { kind: 'translate', translateMode: 'tm' },
    'llm-verify': { kind: 'verify' },
    'skip-detect': { kind: 'skip-detect' },
    'gender-detect': { kind: 'gender-detect' },
    'voice-generate': { kind: 'voice' },
  };

const AI_JOB_KINDS = Object.keys(UI_KIND) as JobKind[];

export const listActiveModAiJobs = async (): Promise<ActiveModAiJob[]> => {
  const jobs = await listUnfinishedJobs(AI_JOB_KINDS);
  const active = await Promise.all(
    jobs.map(async (job): Promise<ActiveModAiJob | null> => {
      const mapping = UI_KIND[job.data.kind];
      const jobId = fromBullJobId(job.id);
      if (!mapping || job.data.modId == null || jobId == null) return null;
      const snapshot = await readJobSnapshot(jobId);
      if (snapshot && TERMINAL_SNAPSHOT.has(snapshot.status)) {
        void cleanupZombieQueueJob(job);
        return null;
      }
      const params = job.data.params as { speakerKey?: unknown } | undefined;
      const speakerKey =
        typeof params?.speakerKey === 'string' && params.speakerKey.trim()
          ? params.speakerKey.trim()
          : null;
      return {
        jobId,
        modId: job.data.modId,
        kind: mapping.kind,
        done: snapshot?.done ?? 0,
        total: snapshot?.total ?? 0,
        status: 'running',
        translateMode: mapping.translateMode,
        ...(mapping.kind === 'voice' ? { speakerKey } : {}),
      };
    }),
  );
  return active.filter((job): job is ActiveModAiJob => job != null);
};

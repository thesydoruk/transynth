/**
 * `GET /api/ai-jobs/active` — mod-scoped AI jobs currently queued or running.
 *
 * Maps BullMQ kinds onto the compact UI labels (`translate` / `verify` / …)
 * and merges live counters from the Redis snapshot when available.
 */
import { fromBullJobId, listUnfinishedJobs } from '../core/queue';
import { readJobSnapshot } from '../core/snapshots';
import type { JobKind } from '../types';

export type ModAiJobKind =
  | 'translate'
  | 'verify'
  | 'skip-detect'
  | 'gender-detect'
  | 'stress-place'
  | 'voice';
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
    'stress-place': { kind: 'stress-place' },
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
        ...(mapping.kind === 'voice' || mapping.kind === 'stress-place' ? { speakerKey } : {}),
      };
    }),
  );
  return active.filter((job): job is ActiveModAiJob => job != null);
};

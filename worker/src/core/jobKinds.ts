/**
 * What every job kind needs, and therefore where it runs.
 *
 * A queue is a resource class, not a feature: jobs that drive one GPU service share one
 * serial queue so the service sees one job at a time (its own pool parallelises inside
 * the job), while CPU-only work (imports, TM, exports) fans out on the `cpu` queue.
 * `needs` lists the service kinds a job calls, which is what the health wait checks
 * and what a scheduler will use to decide which service to bring up next.
 *
 * `WORKER_QUEUES` picks the queues one worker process serves (default: all), so a
 * second worker next to a GPU host can take only `tts`, or only `asr,separate`.
 */
import type { ServiceKind } from '../../../src/services/kinds';
import { JOB_KINDS, type JobKind } from '../types';

export const JOB_QUEUE_IDS = ['cpu', 'llm', 'tts', 'asr', 'separate'] as const;
export type JobQueueId = (typeof JOB_QUEUE_IDS)[number];

/** BullMQ queue names; the first three predate the resource split and keep their names. */
export const QUEUE_NAME_BY_ID: Record<JobQueueId, string> = {
  cpu: 'transynth-jobs',
  llm: 'transynth-llm',
  tts: 'transynth-voice',
  asr: 'transynth-asr',
  separate: 'transynth-separate',
};

export type JobKindSpec = {
  queue: JobQueueId;
  needs: readonly ServiceKind[];
};

export const JOB_KIND_SPECS: Record<JobKind, JobKindSpec> = {
  'llm-translate': { queue: 'llm', needs: ['llm', 'embed'] },
  'llm-verify': { queue: 'llm', needs: ['llm', 'embed'] },
  'skip-detect': { queue: 'llm', needs: ['llm'] },
  'gender-detect': { queue: 'llm', needs: ['llm'] },
  'batch-translate': { queue: 'llm', needs: ['llm', 'embed'] },
  'voice-generate': { queue: 'tts', needs: ['tts', 'asr', 'tools'] },
  'tm-apply': { queue: 'cpu', needs: [] },
  'apply-imported': { queue: 'cpu', needs: [] },
  'mod-import': { queue: 'cpu', needs: [] },
  'csv-import': { queue: 'cpu', needs: [] },
  'eet-import': { queue: 'cpu', needs: [] },
  'langpack-export': { queue: 'cpu', needs: [] },
  'vortex-sync': { queue: 'cpu', needs: [] },
};

const jobKindSpec = (kind: JobKind): JobKindSpec => {
  const spec = JOB_KIND_SPECS[kind];
  if (!spec) throw new Error(`No job spec registered for kind "${kind}"`);
  return spec;
};

export const queueIdForKind = (kind: JobKind): JobQueueId => jobKindSpec(kind).queue;

/** Kinds on one queue (for recovery and the dashboard). */
export const kindsOnQueue = (queue: JobQueueId): JobKind[] =>
  JOB_KINDS.filter((kind) => JOB_KIND_SPECS[kind].queue === queue);

/** Default BullMQ concurrency per queue; `cpu` takes `JOB_CONCURRENCY`, GPU queues run one job. */
export const queueConcurrency = (
  queue: JobQueueId,
  env: NodeJS.ProcessEnv = process.env,
  cpuDefault = 8,
): number => {
  const override = Number.parseInt(env[`JOB_CONCURRENCY_${queue.toUpperCase()}`] ?? '', 10);
  if (Number.isFinite(override) && override >= 1) return Math.min(override, 32);
  return queue === 'cpu' ? cpuDefault : 1;
};

/** Queues this process serves: `WORKER_QUEUES=llm,tts` (unknown ids are ignored, empty = all). */
export const servedQueueIds = (env: NodeJS.ProcessEnv = process.env): JobQueueId[] => {
  const raw = (env.WORKER_QUEUES ?? '').trim();
  if (!raw || raw === '*' || raw.toLowerCase() === 'all') return [...JOB_QUEUE_IDS];
  const wanted = raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const served = JOB_QUEUE_IDS.filter((id) => wanted.includes(id));
  return served.length > 0 ? served : [...JOB_QUEUE_IDS];
};

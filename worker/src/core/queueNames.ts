/**
 * BullMQ queue names and kind → queue routing.
 *
 * Two dedicated serial queues (concurrency 1) sit beside the general queue:
 *   • `transynth-voice` — Fish Speech / Wine synthesis
 *   • `transynth-llm`   — chat / embed pipelines
 *
 * They run independently, so a translate can proceed while a voice job synthesizes.
 * `tm-apply` and imports stay on `transynth-jobs` (JOB_CONCURRENCY) — no LLM.
 */
import type { JobKind } from '../types';

export const JOBS_QUEUE_NAME = 'transynth-jobs';
export const LLM_QUEUE_NAME = 'transynth-llm';
export const VOICE_QUEUE_NAME = 'transynth-voice';

/** Dedicated queues first so unfinished-job lookups prefer the post-migration copy. */
export const ALL_QUEUE_NAMES = [VOICE_QUEUE_NAME, LLM_QUEUE_NAME, JOBS_QUEUE_NAME] as const;

export type JobQueueName = (typeof ALL_QUEUE_NAMES)[number];

export const LLM_JOB_KINDS = [
  'llm-translate',
  'llm-verify',
  'skip-detect',
  'gender-detect',
  'batch-translate',
] as const satisfies readonly JobKind[];

export type LlmJobKind = (typeof LLM_JOB_KINDS)[number];

const LLM_KIND_SET = new Set<JobKind>(LLM_JOB_KINDS);

export const isLlmJobKind = (kind: JobKind): kind is LlmJobKind => LLM_KIND_SET.has(kind);

export const queueNameForKind = (kind: JobKind): JobQueueName => {
  if (kind === 'voice-generate') return VOICE_QUEUE_NAME;
  if (isLlmJobKind(kind)) return LLM_QUEUE_NAME;
  return JOBS_QUEUE_NAME;
};

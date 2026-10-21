/**
 * BullMQ queue names and kind → queue routing, derived from the job specs.
 *
 * One serial queue per GPU service (`llm`, `tts`, `asr`, `separate`) beside the general
 * `cpu` queue (JOB_CONCURRENCY): a translate proceeds while a voice job synthesizes, and
 * each service sees one job at a time. See `jobKinds.ts` for which kind needs what.
 */
import type { JobKind } from '../types';
import { QUEUE_NAME_BY_ID, kindsOnQueue, queueIdForKind } from './jobKinds';

export const JOBS_QUEUE_NAME = QUEUE_NAME_BY_ID.cpu;
export const LLM_QUEUE_NAME = QUEUE_NAME_BY_ID.llm;
export const VOICE_QUEUE_NAME = QUEUE_NAME_BY_ID.tts;
const ASR_QUEUE_NAME = QUEUE_NAME_BY_ID.asr;
const SEPARATE_QUEUE_NAME = QUEUE_NAME_BY_ID.separate;

/** Dedicated queues first so unfinished-job lookups prefer the post-migration copy. */
export const ALL_QUEUE_NAMES = [
  VOICE_QUEUE_NAME,
  LLM_QUEUE_NAME,
  ASR_QUEUE_NAME,
  SEPARATE_QUEUE_NAME,
  JOBS_QUEUE_NAME,
] as const;

export type JobQueueName = (typeof ALL_QUEUE_NAMES)[number];

const LLM_KIND_SET = new Set<JobKind>(kindsOnQueue('llm'));

export type LlmJobKind = JobKind;

export const isLlmJobKind = (kind: JobKind): boolean => LLM_KIND_SET.has(kind);

export const queueNameForKind = (kind: JobKind): JobQueueName =>
  QUEUE_NAME_BY_ID[queueIdForKind(kind)] as JobQueueName;

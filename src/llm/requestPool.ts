/**
 * Independent global pools for LLM chat and embedding HTTP requests.
 *
 * Each pool has its own concurrency limit (`LLM_MAX_PARALLEL`, `EMBED_MAX_PARALLEL`).
 * Bulk pipelines should run RAG (embed) and chat in separate phases so neither pool
 * blocks the other.
 */
import { CONFIG } from '../config';
import { Semaphore } from '../utils/concurrency';

export type RequestPoolStats = {
  inFlight: number;
  queued: number;
  max: number;
};

/** Bounded-concurrency wrapper with observability for one request kind. */
export class RequestPool {
  constructor(private readonly semaphore: Semaphore) {}

  get stats(): RequestPoolStats {
    return {
      inFlight: this.semaphore.activeCount,
      queued: this.semaphore.queuedCount,
      max: this.semaphore.maxConcurrency,
    };
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    return this.semaphore.run(fn);
  }
}

/** Chat/completion requests (translate, verify, skip-detect, locale detect). */
export const llmChatPool = new RequestPool(new Semaphore(CONFIG.llmMaxParallel));

/** Embedding requests (RAG indexing and retrieval). */
export const embedPool = new RequestPool(new Semaphore(CONFIG.embedMaxParallel));

/** Worker count for the RAG phase — aligned with the embed pool size. */
export const llmRagConcurrency = (): number => CONFIG.embedMaxParallel;

/**
 * Worker count for the chat phase.
 * +1 keeps chat slots saturated while a worker persists DB results.
 */
export const llmChatPipelineConcurrency = (): number => CONFIG.llmMaxParallel + 1;

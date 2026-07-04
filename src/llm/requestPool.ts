/**
 * Independent global pools for LLM chat and embedding HTTP requests.
 *
 * Chat uses per-server limits when `VLLM_SERVERS` is configured; otherwise a single
 * global semaphore (`LLM_MAX_PARALLEL`). Embed pool is separate (`EMBED_MAX_PARALLEL`).
 */
import { CONFIG } from '../config';
import { Semaphore } from '../utils/concurrency';
import { MultiServerChatPool } from './multiServerChatPool';
import type OpenAI from 'openai';

export type RequestPoolStats = {
  inFlight: number;
  queued: number;
  max: number;
  servers?: Array<{
    index: number;
    host: string;
    inFlight: number;
    queued: number;
    max: number;
  }>;
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

type ChatPool = {
  stats: RequestPoolStats;
  run<T>(fn: () => Promise<T>): Promise<T>;
  runWithClient?<T>(
    fn: (client: OpenAI, meta: { host: string; index: number }) => Promise<T>,
  ): Promise<T>;
};

const buildChatPool = (): ChatPool => {
  if (CONFIG.vllmMultiServer) {
    const multi = new MultiServerChatPool(CONFIG.vllmServers);
    const openaiPool = new RequestPool(new Semaphore(CONFIG.llmMaxParallel));
    return {
      get stats(): RequestPoolStats {
        return CONFIG.llmProvider === 'vllm' ? multi.stats : openaiPool.stats;
      },
      run: <T>(fn: () => Promise<T>) => openaiPool.run(fn),
      runWithClient: <T>(
        fn: (client: OpenAI, meta: { host: string; index: number }) => Promise<T>,
      ) => multi.run(fn),
    };
  }

  const single = new RequestPool(new Semaphore(CONFIG.llmMaxParallel));
  return {
    get stats(): RequestPoolStats {
      return single.stats;
    },
    run: <T>(fn: () => Promise<T>) => single.run(fn),
  };
};

/** Chat/completion requests (translate, verify, skip-detect, locale detect). */
export const llmChatPool: ChatPool = buildChatPool();

/** Embedding requests (RAG indexing and retrieval). */
export const embedPool = new RequestPool(new Semaphore(CONFIG.embedMaxParallel));

/** Worker count for the RAG phase — aligned with the embed pool size. */
export const llmRagConcurrency = (): number => CONFIG.embedMaxParallel;

/**
 * Worker count for pipelined RAG→chat batches (translate, verify).
 * Aligned with the chat pool; +1 overlaps DB writes with the next chat slot.
 */
export const llmChatPipelineConcurrency = (): number => CONFIG.llmMaxParallel + 1;

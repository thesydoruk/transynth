/**
 * Independent global pools for LLM chat and embedding HTTP requests.
 *
 * Chat uses per-server limits when multi-server routing is active; otherwise a
 * single global semaphore. Embed pool is separate (`EMBED_MAX_PARALLEL`).
 * Chat servers/limits are refreshed from project settings via {@link syncLlmChatPool}.
 */
import { CONFIG } from '../config';
import { Semaphore } from '../utils/concurrency';
import { MultiServerChatPool } from './multiServerChatPool';
import type { VllmServerEntry } from './vllmServerConfig';
import { totalVllmChatParallel } from './vllmServerConfig';
import type OpenAI from 'openai';

export type RequestPoolStats = {
  inFlight: number;
  queued: number;
  max: number;
  healthyMax?: number;
  servers?: Array<{
    index: number;
    host: string;
    inFlight: number;
    queued: number;
    max: number;
    healthy?: boolean;
    lastHealthCheckAt?: number | null;
    lastHealthError?: string | null;
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

  syncLimit(maxParallel: number): void {
    this.semaphore.setMaxConcurrency(maxParallel);
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    return this.semaphore.run(fn);
  }
}

type ChatPool = {
  stats: RequestPoolStats;
  dispose?: () => void;
  run<T>(fn: () => Promise<T>): Promise<T>;
  runWithClient?<T>(
    fn: (client: OpenAI, meta: { host: string; index: number }) => Promise<T>,
  ): Promise<T>;
};

const buildChatPool = (servers: readonly VllmServerEntry[], multi: boolean): ChatPool => {
  if (multi) {
    const multiPool = new MultiServerChatPool(servers);
    const openaiPool = new RequestPool(new Semaphore(totalVllmChatParallel(servers)));
    return {
      get stats(): RequestPoolStats {
        return CONFIG.llmProvider === 'vllm' ? multiPool.stats : openaiPool.stats;
      },
      dispose: () => multiPool.dispose(),
      run: <T>(fn: () => Promise<T>) => openaiPool.run(fn),
      runWithClient: <T>(
        fn: (client: OpenAI, meta: { host: string; index: number }) => Promise<T>,
      ) => multiPool.run(fn),
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

let chatPoolImpl: ChatPool = buildChatPool(CONFIG.vllmServers, CONFIG.vllmMultiServer);

/** Chat/completion requests (translate, verify, skip-detect, locale detect). */
export const llmChatPool: ChatPool = {
  get stats(): RequestPoolStats {
    return chatPoolImpl.stats;
  },
  run: <T>(fn: () => Promise<T>) => chatPoolImpl.run(fn),
  runWithClient: <T>(fn: (client: OpenAI, meta: { host: string; index: number }) => Promise<T>) => {
    if (!chatPoolImpl.runWithClient) {
      throw new Error('Multi-server chat pool is not active');
    }
    return chatPoolImpl.runWithClient(fn);
  },
};

/** Rebuild the chat pool after project-settings / env server list changes. */
export const syncLlmChatPool = (servers: readonly VllmServerEntry[], multi: boolean): void => {
  chatPoolImpl.dispose?.();
  chatPoolImpl = buildChatPool(servers, multi);
};

/** Embedding requests (RAG indexing and retrieval). */
export const embedPool = new RequestPool(new Semaphore(CONFIG.embedMaxParallel));

/** Worker count for the RAG phase — aligned with the embed pool size. */
export const llmRagConcurrency = (): number => CONFIG.embedMaxParallel;

/**
 * Worker count for pipelined RAG→chat batches (translate, verify).
 * Aligned with the chat pool; +1 overlaps DB writes with the next chat slot.
 */
export const llmChatPipelineConcurrency = (): number => CONFIG.llmMaxParallel + 1;

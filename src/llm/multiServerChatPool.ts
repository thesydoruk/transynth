import OpenAI from 'openai';
import type { VllmServerEntry } from './vllmServerConfig';
import { CONFIG } from '../config';
import { Semaphore } from '../utils/concurrency';
import { normalizeVllmBaseUrl } from './vllmClient';

export type VllmServerSlot = {
  index: number;
  host: string;
  maxParallel: number;
  apiKeyConfigured: boolean;
  client: OpenAI;
  semaphore: Semaphore;
};

export type MultiServerChatPoolStats = {
  inFlight: number;
  queued: number;
  max: number;
  servers: Array<{
    index: number;
    host: string;
    inFlight: number;
    queued: number;
    max: number;
  }>;
};

const createOpenAiClient = (host: string, apiKey: string): OpenAI =>
  new OpenAI({
    apiKey: apiKey || 'EMPTY',
    baseURL: normalizeVllmBaseUrl(host),
    timeout: CONFIG.llmRequestTimeoutMs,
    maxRetries: 0,
  });

const slotLoad = (slot: VllmServerSlot): number =>
  (slot.semaphore.activeCount + slot.semaphore.queuedCount) / slot.maxParallel;

/**
 * Routes chat HTTP calls across identical vLLM servers.
 * Each server has its own concurrency limit and OpenAI client.
 */
export class MultiServerChatPool {
  readonly slots: readonly VllmServerSlot[];
  private pickCursor = 0;

  constructor(servers: readonly VllmServerEntry[]) {
    this.slots = servers.map((server, index) => ({
      index,
      host: server.host,
      maxParallel: server.maxParallel,
      apiKeyConfigured: Boolean(server.apiKey),
      client: createOpenAiClient(server.host, server.apiKey),
      semaphore: new Semaphore(server.maxParallel),
    }));
  }

  get stats(): MultiServerChatPoolStats {
    const servers = this.slots.map((slot) => ({
      index: slot.index,
      host: slot.host,
      inFlight: slot.semaphore.activeCount,
      queued: slot.semaphore.queuedCount,
      max: slot.semaphore.maxConcurrency,
    }));
    return {
      inFlight: servers.reduce((n, s) => n + s.inFlight, 0),
      queued: servers.reduce((n, s) => n + s.queued, 0),
      max: servers.reduce((n, s) => n + s.max, 0),
      servers,
    };
  }

  /** Pick the least-loaded server; ties rotate fairly. */
  private pickSlot(): VllmServerSlot {
    if (this.slots.length === 1) return this.slots[0]!;

    let bestLoad = Infinity;
    const candidates: VllmServerSlot[] = [];

    for (const slot of this.slots) {
      const load = slotLoad(slot);
      if (load < bestLoad) {
        bestLoad = load;
        candidates.length = 0;
        candidates.push(slot);
      } else if (load === bestLoad) {
        candidates.push(slot);
      }
    }

    const slot = candidates[this.pickCursor % candidates.length]!;
    this.pickCursor = (this.pickCursor + 1) % Math.max(candidates.length, 1);
    return slot;
  }

  run<T>(fn: (client: OpenAI, meta: { host: string; index: number }) => Promise<T>): Promise<T> {
    const slot = this.pickSlot();
    return slot.semaphore.run(() => fn(slot.client, { host: slot.host, index: slot.index }));
  }
}

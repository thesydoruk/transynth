import OpenAI from 'openai';
import type { VllmServerEntry } from './vllmServerConfig';
import { CONFIG } from '../config';
import { logLlm } from '../logging/loggers';
import { Semaphore } from '../utils/concurrency';
import { normalizeVllmBaseUrl } from './vllmClient';
import {
  isVllmConnectionError,
  NoHealthyVllmServerError,
  probeVllmServerHealth,
} from './vllmServerHealth';

export type VllmServerSlot = {
  index: number;
  host: string;
  maxParallel: number;
  apiKey: string;
  apiKeyConfigured: boolean;
  client: OpenAI;
  semaphore: Semaphore;
  healthy: boolean;
  lastHealthCheckAt: number | null;
  lastHealthError: string | null;
};

export type MultiServerChatPoolStats = {
  inFlight: number;
  queued: number;
  max: number;
  healthyMax: number;
  servers: Array<{
    index: number;
    host: string;
    inFlight: number;
    queued: number;
    max: number;
    healthy: boolean;
    lastHealthCheckAt: number | null;
    lastHealthError: string | null;
  }>;
};

export type MultiServerChatPoolOptions = {
  healthIntervalMs?: number;
  healthTimeoutMs?: number;
  /** Injected for tests. */
  probe?: typeof probeVllmServerHealth;
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
 * Unhealthy hosts are skipped until the periodic probe marks them healthy again.
 */
export class MultiServerChatPool {
  readonly slots: readonly VllmServerSlot[];
  private pickCursor = 0;
  private readonly healthTimeoutMs: number;
  private readonly probe: typeof probeVllmServerHealth;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private probeInFlight = false;
  private disposed = false;

  constructor(servers: readonly VllmServerEntry[], opts: MultiServerChatPoolOptions = {}) {
    this.healthTimeoutMs = opts.healthTimeoutMs ?? CONFIG.vllmHealthTimeoutMs;
    this.probe = opts.probe ?? probeVllmServerHealth;
    this.slots = servers.map((server, index) => ({
      index,
      host: server.host,
      maxParallel: server.maxParallel,
      apiKey: server.apiKey,
      apiKeyConfigured: Boolean(server.apiKey),
      client: createOpenAiClient(server.host, server.apiKey),
      semaphore: new Semaphore(server.maxParallel),
      healthy: true,
      lastHealthCheckAt: null,
      lastHealthError: null,
    }));

    const intervalMs = opts.healthIntervalMs ?? CONFIG.vllmHealthIntervalMs;
    if (this.slots.length > 0 && intervalMs > 0) {
      void this.runHealthChecks();
      this.healthTimer = setInterval(() => void this.runHealthChecks(), intervalMs);
      this.healthTimer.unref?.();
    }
  }

  /** Stop the periodic probe (call when the pool is replaced). */
  dispose(): void {
    this.disposed = true;
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  get stats(): MultiServerChatPoolStats {
    const servers = this.slots.map((slot) => ({
      index: slot.index,
      host: slot.host,
      inFlight: slot.semaphore.activeCount,
      queued: slot.semaphore.queuedCount,
      max: slot.semaphore.maxConcurrency,
      healthy: slot.healthy,
      lastHealthCheckAt: slot.lastHealthCheckAt,
      lastHealthError: slot.lastHealthError,
    }));
    return {
      inFlight: servers.reduce((n, s) => n + s.inFlight, 0),
      queued: servers.reduce((n, s) => n + s.queued, 0),
      max: servers.reduce((n, s) => n + s.max, 0),
      healthyMax: servers.filter((s) => s.healthy).reduce((n, s) => n + s.max, 0),
      servers,
    };
  }

  /** Pick the least-loaded healthy server; ties rotate fairly. */
  private pickSlot(): VllmServerSlot {
    const healthy = this.slots.filter((slot) => slot.healthy);
    if (healthy.length === 0) {
      throw new NoHealthyVllmServerError(this.slots.map((s) => s.host));
    }
    if (healthy.length === 1) return healthy[0]!;

    let bestLoad = Infinity;
    const candidates: VllmServerSlot[] = [];

    for (const slot of healthy) {
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

  private setHealthy(slot: VllmServerSlot, healthy: boolean, error: string | null): void {
    const changed = slot.healthy !== healthy;
    slot.healthy = healthy;
    slot.lastHealthCheckAt = Date.now();
    slot.lastHealthError = error;
    if (changed) {
      logLlm.warn(healthy ? 'vLLM server healthy again' : 'vLLM server marked unhealthy', {
        host: slot.host,
        index: slot.index,
        error,
        pool: this.stats,
      });
    }
  }

  /** Probe every host; used by the interval and tests. */
  async runHealthChecks(): Promise<void> {
    if (this.disposed || this.probeInFlight) return;
    this.probeInFlight = true;
    try {
      await Promise.all(
        this.slots.map(async (slot) => {
          const ok = await this.probe(slot.host, slot.apiKey, this.healthTimeoutMs);
          if (this.disposed) return;
          this.setHealthy(slot, ok, ok ? null : 'health probe failed');
        }),
      );
    } finally {
      this.probeInFlight = false;
    }
  }

  run<T>(fn: (client: OpenAI, meta: { host: string; index: number }) => Promise<T>): Promise<T> {
    let slot: VllmServerSlot;
    try {
      slot = this.pickSlot();
    } catch (err) {
      return Promise.reject(err);
    }
    return slot.semaphore.run(async () => {
      try {
        return await fn(slot.client, { host: slot.host, index: slot.index });
      } catch (err) {
        if (isVllmConnectionError(err)) {
          this.setHealthy(slot, false, err instanceof Error ? err.message : String(err));
        }
        throw err;
      }
    });
  }
}

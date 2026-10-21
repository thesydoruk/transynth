/**
 * A pool over the endpoints of one service kind.
 *
 * The chat pool already did this for vLLM: one semaphore per host, a periodic health
 * probe, the least-loaded healthy host for each call, and a host that refuses a
 * connection leaving the pool until the probe brings it back. This is that logic with
 * the client and the probe injected, so TTS, audio-intel and bethesda-tools get the
 * same behaviour and the same `stats` shape, and the UI can show them side by side.
 */
import { CONFIG } from '../config';
import { log } from '../logger';
import { Semaphore } from '../utils/concurrency';
import { SERVICE_LABELS, type ServiceEndpoint, type ServiceKind } from './kinds';

export type ServiceSlot<TClient> = {
  index: number;
  kind: ServiceKind;
  host: string;
  maxParallel: number;
  apiKey: string;
  apiKeyConfigured: boolean;
  client: TClient;
  semaphore: Semaphore;
  healthy: boolean;
  lastHealthCheckAt: number | null;
  lastHealthError: string | null;
};

export type ServicePoolStats = {
  kind: ServiceKind;
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

export type HealthProbeResult = { ok: true } | { ok: false; error: string };

export type ServicePoolOptions<TClient> = {
  kind: ServiceKind;
  endpoints: readonly ServiceEndpoint[];
  /** Build the per-host client once (an OpenAI client, or just the base URL). */
  createClient: (endpoint: ServiceEndpoint) => TClient;
  /** Readiness probe of one host; must not throw. */
  probe: (endpoint: ServiceEndpoint, timeoutMs: number) => Promise<HealthProbeResult>;
  /** Transport failures that should take a host out of the pool. */
  isConnectionError?: (err: unknown) => boolean;
  healthIntervalMs?: number;
  healthTimeoutMs?: number;
  /** Probe every host right away instead of waiting for the first interval tick. */
  probeOnStart?: boolean;
};

/** Thrown when every host of a kind failed its health check (or none is configured). */
export class NoHealthyServiceError extends Error {
  readonly status = 503;
  readonly kind: ServiceKind;

  constructor(kind: ServiceKind, hosts: readonly string[]) {
    super(
      hosts.length === 0
        ? `No ${SERVICE_LABELS[kind]} endpoints configured`
        : `No healthy ${SERVICE_LABELS[kind]} endpoints (${hosts.join(', ')})`,
    );
    this.name = 'NoHealthyServiceError';
    this.kind = kind;
  }
}

const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET']);

/** Default transport-failure test: codes, gateway statuses, fetch's "fetch failed". */
export const isServiceConnectionError = (err: unknown): boolean => {
  const e = err as {
    code?: string;
    status?: number;
    name?: string;
    message?: string;
    cause?: unknown;
  };
  if (e?.code && CONNECTION_CODES.has(e.code)) return true;
  if (e?.status === 502 || e?.status === 503 || e?.status === 504) return true;
  if (e?.name === 'APIConnectionTimeoutError' || e?.name === 'TimeoutError') return true;
  const cause = e?.cause as { code?: string } | undefined;
  if (cause?.code && CONNECTION_CODES.has(cause.code)) return true;
  const msg = (e?.message ?? String(err)).toLowerCase();
  return (
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('etimedout') ||
    msg.includes('fetch failed') ||
    msg.includes('network')
  );
};

const slotLoad = (slot: ServiceSlot<unknown>): number =>
  (slot.semaphore.activeCount + slot.semaphore.queuedCount) / slot.maxParallel;

export class ServicePool<TClient> {
  readonly kind: ServiceKind;
  readonly slots: readonly ServiceSlot<TClient>[];
  private pickCursor = 0;
  private readonly probeFn: ServicePoolOptions<TClient>['probe'];
  private readonly isConnectionError: (err: unknown) => boolean;
  private readonly healthTimeoutMs: number;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private probeInFlight = false;
  private probeWaiters: Array<() => void> = [];
  private disposed = false;

  constructor(options: ServicePoolOptions<TClient>) {
    this.kind = options.kind;
    this.probeFn = options.probe;
    this.isConnectionError = options.isConnectionError ?? isServiceConnectionError;
    this.healthTimeoutMs = options.healthTimeoutMs ?? CONFIG.vllmHealthTimeoutMs;
    this.slots = options.endpoints.map((endpoint, index) => ({
      index,
      kind: endpoint.kind,
      host: endpoint.host,
      maxParallel: endpoint.maxParallel,
      apiKey: endpoint.apiKey,
      apiKeyConfigured: Boolean(endpoint.apiKey),
      client: options.createClient(endpoint),
      semaphore: new Semaphore(endpoint.maxParallel),
      healthy: true,
      lastHealthCheckAt: null,
      lastHealthError: null,
    }));
    const intervalMs = options.healthIntervalMs ?? CONFIG.vllmHealthIntervalMs;
    if (this.slots.length > 0 && intervalMs > 0) {
      if (options.probeOnStart) void this.runHealthChecks();
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

  get stats(): ServicePoolStats {
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
      kind: this.kind,
      inFlight: servers.reduce((n, s) => n + s.inFlight, 0),
      queued: servers.reduce((n, s) => n + s.queued, 0),
      max: servers.reduce((n, s) => n + s.max, 0),
      healthyMax: servers.filter((s) => s.healthy).reduce((n, s) => n + s.max, 0),
      servers,
    };
  }

  /** Sum of per-host limits; +1 is the usual pipeline worker count. */
  get maxParallel(): number {
    return this.slots.reduce((n, s) => n + s.maxParallel, 0);
  }

  hosts(): string[] {
    return this.slots.map((s) => s.host);
  }

  /** Pick the least-loaded healthy host; ties rotate fairly. */
  pickSlot(): ServiceSlot<TClient> {
    const healthy = this.slots.filter((slot) => slot.healthy);
    if (healthy.length === 0) throw new NoHealthyServiceError(this.kind, this.hosts());
    if (healthy.length === 1) return healthy[0]!;
    let bestLoad = Infinity;
    const candidates: ServiceSlot<TClient>[] = [];
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

  private setHealthy(slot: ServiceSlot<TClient>, healthy: boolean, error: string | null): void {
    const changed = slot.healthy !== healthy;
    slot.healthy = healthy;
    slot.lastHealthCheckAt = Date.now();
    slot.lastHealthError = error;
    if (changed) {
      log.warn(
        healthy
          ? `${SERVICE_LABELS[this.kind]} endpoint healthy again`
          : `${SERVICE_LABELS[this.kind]} endpoint marked unhealthy`,
        { kind: this.kind, host: slot.host, index: slot.index, error },
      );
    }
  }

  /** Probe every host; used by the interval, the job wait, and tests. */
  async runHealthChecks(): Promise<void> {
    if (this.disposed) return;
    if (this.probeInFlight) {
      await new Promise<void>((resolve) => this.probeWaiters.push(resolve));
      return;
    }
    this.probeInFlight = true;
    try {
      await Promise.all(
        this.slots.map(async (slot) => {
          const result = await this.probeFn(
            {
              kind: slot.kind,
              host: slot.host,
              maxParallel: slot.maxParallel,
              apiKey: slot.apiKey,
              managed: false,
            },
            this.healthTimeoutMs,
          );
          if (this.disposed) return;
          this.setHealthy(slot, result.ok, result.ok ? null : result.error);
        }),
      );
    } finally {
      this.probeInFlight = false;
      const waiters = this.probeWaiters;
      this.probeWaiters = [];
      for (const wake of waiters) wake();
    }
  }

  /** Probe now and say whether any host can take work (the job wait uses this). */
  async probeHealth(): Promise<HealthProbeResult> {
    if (this.slots.length === 0) {
      return { ok: false, error: `No ${SERVICE_LABELS[this.kind]} endpoints configured` };
    }
    await this.runHealthChecks();
    if (this.stats.healthyMax > 0) return { ok: true };
    const errors = this.slots
      .map((s) => `${s.host}: ${s.lastHealthError ?? 'unhealthy'}`)
      .join('; ');
    return { ok: false, error: `No healthy ${SERVICE_LABELS[this.kind]} endpoints (${errors})` };
  }

  /** Run `fn` on the least-loaded healthy host under its concurrency limit. */
  run<T>(fn: (client: TClient, meta: { host: string; index: number }) => Promise<T>): Promise<T> {
    let slot: ServiceSlot<TClient>;
    try {
      slot = this.pickSlot();
    } catch (err) {
      return Promise.reject(err);
    }
    return slot.semaphore.run(async () => {
      try {
        return await fn(slot.client, { host: slot.host, index: slot.index });
      } catch (err) {
        if (this.isConnectionError(err)) {
          this.setHealthy(slot, false, err instanceof Error ? err.message : String(err));
        }
        throw err;
      }
    });
  }
}

/**
 * The chat pool: one OpenAI client per vLLM host on top of the generic service pool.
 *
 * Routing, per-host limits and health handling live in `services/pool`; this adds the
 * OpenAI client, vLLM's `/v1/models` probe and the error type the LLM layer expects.
 */
import OpenAI from 'openai';
import type { VllmServerEntry } from './vllmServerConfig';
import { CONFIG } from '../config';
import { ServicePool, type ServicePoolStats, type ServiceSlot } from '../services/pool';
import { normalizeVllmBaseUrl } from './vllmClient';
import {
  isVllmConnectionError,
  NoHealthyVllmServerError,
  probeVllmServerHealth,
} from './vllmServerHealth';

export type VllmServerSlot = ServiceSlot<OpenAI>;
export type MultiServerChatPoolStats = ServicePoolStats;

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

/**
 * Routes chat HTTP calls across identical vLLM servers.
 * Unhealthy hosts are skipped until the periodic probe marks them healthy again.
 */
export class MultiServerChatPool extends ServicePool<OpenAI> {
  constructor(servers: readonly VllmServerEntry[], opts: MultiServerChatPoolOptions = {}) {
    const probe = opts.probe ?? probeVllmServerHealth;
    super({
      kind: 'llm',
      endpoints: servers.map((server) => ({
        kind: 'llm',
        host: server.host,
        maxParallel: server.maxParallel,
        apiKey: server.apiKey,
        managed: false,
      })),
      createClient: (endpoint) => createOpenAiClient(endpoint.host, endpoint.apiKey),
      probe: async (endpoint, timeoutMs) =>
        (await probe(endpoint.host, endpoint.apiKey, timeoutMs))
          ? { ok: true }
          : { ok: false, error: 'health probe failed' },
      isConnectionError: isVllmConnectionError,
      healthIntervalMs: opts.healthIntervalMs,
      healthTimeoutMs: opts.healthTimeoutMs,
      probeOnStart: true,
    });
  }

  override pickSlot(): VllmServerSlot {
    try {
      return super.pickSlot();
    } catch {
      throw new NoHealthyVllmServerError(this.hosts());
    }
  }
}

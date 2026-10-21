/**
 * One readiness probe per service kind, in the shape the pools expect.
 *
 * - `llm`: OpenAI-compatible `GET /v1/models` (vLLM, OpenAI).
 * - `embed`: `GET /health` first (text-embeddings-inference has no `/v1/models`),
 *   then `GET /v1/models` for OpenAI-compatible servers (vLLM, OpenAI).
 * - `tts`: Fish Speech `GET /health`, not ready while the engine loads.
 * - `asr`: audio-intel `GET /health`.
 * - `separate`: the same `GET /health`, but the instance must run a batch lane
 *   (audio-intel ≥ 2.2 reports it as `batch`).
 * - `tools`: bethesda-tools `GET /health`.
 */
import { probeAudioIntelHealth, type AudioIntelHealthBody } from '../audioIntel/health';
import { probeVllmServerHealth } from '../llm/vllmServerHealth';
import { probeTtsHealth } from '../tts/ttsHealth';
import type { ServiceEndpoint } from './kinds';
import type { HealthProbeResult } from './pool';

const withTimeout = async <T>(
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, timeoutMs));
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
};

const probeToolsHealth = async (host: string, timeoutMs: number): Promise<HealthProbeResult> => {
  try {
    const ok = await withTimeout(timeoutMs, async (signal) => {
      const response = await fetch(`${host}/health`, { method: 'GET', signal });
      return response.ok;
    });
    return ok ? { ok: true } : { ok: false, error: `bethesda-tools health check failed (${host})` };
  } catch {
    return { ok: false, error: `bethesda-tools unreachable (${host})` };
  }
};

/** `/health` lives at the server root, so drop an OpenAI-style `/v1` suffix from the host. */
const rootOf = (host: string): string => host.replace(/\/+$/, '').replace(/\/v1$/, '');

/**
 * Embedding server: TEI answers `GET /health` (200 once the model is loaded) and 404 on
 * `/v1/models`; vLLM and OpenAI answer `/v1/models`. Try the cheap root check first.
 */
const probeEmbedHealth = async (
  endpoint: ServiceEndpoint,
  timeoutMs: number,
): Promise<HealthProbeResult> => {
  const healthOk = await withTimeout(timeoutMs, async (signal) => {
    const response = await fetch(`${rootOf(endpoint.host)}/health`, { method: 'GET', signal });
    return response.ok;
  }).catch(() => false);
  if (healthOk) return { ok: true };
  const modelsOk = await probeVllmServerHealth(endpoint.host, endpoint.apiKey, timeoutMs);
  return modelsOk ? { ok: true } : { ok: false, error: `health check failed (${endpoint.host})` };
};

/** Probe one endpoint of its kind; never throws. */
export const probeServiceEndpoint = async (
  endpoint: ServiceEndpoint,
  timeoutMs: number,
): Promise<HealthProbeResult> => {
  switch (endpoint.kind) {
    case 'llm': {
      const ok = await probeVllmServerHealth(endpoint.host, endpoint.apiKey, timeoutMs);
      return ok ? { ok: true } : { ok: false, error: `health check failed (${endpoint.host})` };
    }
    case 'embed':
      return probeEmbedHealth(endpoint, timeoutMs);
    case 'tts':
      return withTimeout(timeoutMs, (signal) => probeTtsHealth(endpoint.host, signal)).catch(
        () => ({ ok: false, error: `TTS unreachable (${endpoint.host})` }),
      );
    case 'asr':
      return withTimeout(timeoutMs, (signal) => probeAudioIntelHealth(endpoint.host, signal)).catch(
        () => ({ ok: false, error: `audio-intel unreachable (${endpoint.host})` }),
      );
    case 'separate': {
      const result = await withTimeout(timeoutMs, (signal) =>
        probeAudioIntelHealth(endpoint.host, signal),
      ).catch(
        (): HealthProbeResult => ({
          ok: false,
          error: `audio-intel unreachable (${endpoint.host})`,
        }),
      );
      if (!result.ok) return result;
      const body = (result as { body?: AudioIntelHealthBody }).body;
      if (body && !body.batch) {
        return {
          ok: false,
          error: `audio-intel at ${endpoint.host} has no batch lane (SEPARATE_ENABLED=0 or too old)`,
        };
      }
      return { ok: true };
    }
    case 'tools':
      return probeToolsHealth(endpoint.host, timeoutMs);
  }
};

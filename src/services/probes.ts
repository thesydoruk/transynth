/**
 * One readiness probe per service kind, in the shape the pools expect.
 *
 * - `llm` / `embed`: OpenAI-compatible `GET /v1/models` (vLLM, TEI, OpenAI).
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

/** Probe one endpoint of its kind; never throws. */
export const probeServiceEndpoint = async (
  endpoint: ServiceEndpoint,
  timeoutMs: number,
): Promise<HealthProbeResult> => {
  switch (endpoint.kind) {
    case 'llm':
    case 'embed': {
      const ok = await probeVllmServerHealth(endpoint.host, endpoint.apiKey, timeoutMs);
      return ok ? { ok: true } : { ok: false, error: `health check failed (${endpoint.host})` };
    }
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

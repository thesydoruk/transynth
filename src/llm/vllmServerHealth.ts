import { normalizeVllmBaseUrl } from './vllmClient';

const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET']);

/** True for hard transport failures that mean a vLLM host should leave the pool. */
export const isVllmConnectionError = (err: unknown): boolean => {
  const e = err as { code?: string; status?: number; name?: string; message?: string };
  if (e?.code && CONNECTION_CODES.has(e.code)) return true;
  if (e?.status === 502 || e?.status === 503 || e?.status === 504) return true;
  if (e?.name === 'APIConnectionTimeoutError' || e?.name === 'TimeoutError') return true;
  const msg = (e?.message ?? String(err)).toLowerCase();
  return (
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('etimedout') ||
    msg.includes('fetch failed') ||
    msg.includes('network')
  );
};

/**
 * Lightweight readiness probe: `GET {host}/v1/models`.
 * Uses a short timeout so a dead host does not block the health loop.
 */
export const probeVllmServerHealth = async (
  host: string,
  apiKey: string,
  timeoutMs: number,
): Promise<boolean> => {
  const base = normalizeVllmBaseUrl(host);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(250, timeoutMs));
  try {
    const response = await fetch(`${base}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey || 'EMPTY'}`,
      },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

/** Thrown when every chat-pool host failed its health check. */
export class NoHealthyVllmServerError extends Error {
  readonly status = 503;

  constructor(hosts: readonly string[]) {
    super(
      hosts.length === 0
        ? 'No vLLM servers configured in the chat pool'
        : `No healthy vLLM servers in the chat pool (${hosts.join(', ')})`,
    );
    this.name = 'NoHealthyVllmServerError';
  }
}

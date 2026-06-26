// Exponential backoff retry for transient LLM errors (429, 500, 503, network).

import { CONFIG } from '../config';
import { log } from '../logger';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);
const RETRYABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET']);

const isRetryable = (err: unknown): boolean => {
  const e = err as { code?: string; status?: number; response?: { status?: number } };
  if (e?.code && RETRYABLE_CODES.has(e.code)) return true;
  const status = e?.status ?? e?.response?.status;
  return RETRYABLE_STATUSES.has(status as number);
};

/** True for user-initiated aborts (job stopped) — never retry these. */
export const isAbortError = (err: unknown): boolean => {
  const e = err as { name?: string; code?: string };
  return e?.name === 'AbortError' || e?.name === 'APIUserAbortError' || e?.code === 'ABORT_ERR';
};

/** True when the HTTP client or server aborted due to a request timeout. */
export const isLlmTimeoutError = (err: unknown): boolean => {
  const e = err as { name?: string; code?: string; message?: string };
  if (e?.code === 'ETIMEDOUT' || e?.code === 'ESOCKETTIMEDOUT') return true;
  if (e?.name === 'APIConnectionTimeoutError' || e?.name === 'TimeoutError') return true;
  const msg = (e?.message ?? String(err)).toLowerCase();
  return /\btimeout\b/.test(msg) || msg.includes('timed out');
};

/**
 * Retry `fn` up to `maxAttempts` times on transient errors.
 * Backoff: 1s, 2s, 4s, … (capped at 30s) + jitter.
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  maxAttempts = CONFIG.llmMaxAttempts,
): Promise<T> => {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isAbortError(err) || !isRetryable(err) || attempt === maxAttempts - 1) throw err;
      lastErr = err;
      const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 300, 30_000);
      log.warn(
        `Retry ${attempt + 1}/${maxAttempts}: ${(err as Error)?.message || err} — waiting ${Math.round(delay)}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
};

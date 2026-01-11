// Exponential backoff retry for transient LLM errors (429, 500, 503, network).

import { log } from '../logger.js';

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503]);
const RETRYABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET']);

function isRetryable(err: any): boolean {
  if (RETRYABLE_CODES.has(err?.code)) return true;
  const status = err?.status ?? err?.response?.status;
  return RETRYABLE_STATUSES.has(status);
}

/**
 * Retry `fn` up to `maxAttempts` times on transient errors.
 * Backoff: 1s, 2s, 4s, … (capped at 30s) + jitter.
 */
export async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (!isRetryable(err) || attempt === maxAttempts - 1) throw err;
      lastErr = err;
      const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 300, 30_000);
      log.warn(`Retry ${attempt + 1}/${maxAttempts}: ${err?.message || err} — waiting ${Math.round(delay)}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

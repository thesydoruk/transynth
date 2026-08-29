import { log } from '../logger';

const PG_TRANSIENT_CODES = new Set([
  '57P03', // cannot_connect_now (recovery)
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '53300', // too_many_connections
  '40P01', // deadlock_detected
  '40001', // serialization_failure
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
  '08007', // transaction_resolution_unknown
]);

/** True for PostgreSQL / network errors that may succeed on retry. */
export const isPgTransientError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  const code = 'code' in err ? (err as { code?: string }).code : undefined;
  if (code && PG_TRANSIENT_CODES.has(code)) return true;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('connection terminated') ||
    msg.includes('not yet accepting connections') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('deadlock')
  );
};

/** Retry `fn` on transient PostgreSQL / connection errors with exponential backoff. */
export const withPgRetry = async <T>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; label?: string },
): Promise<T> => {
  const maxAttempts = opts?.maxAttempts ?? 5;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isPgTransientError(err) || attempt === maxAttempts - 1) throw err;
      lastErr = err;
      const delay = Math.min(500 * 2 ** attempt + Math.random() * 200, 15_000);
      log.warn(
        `DB retry ${attempt + 1}/${maxAttempts - 1}${opts?.label ? ` (${opts.label})` : ''}: ${(err as Error).message} — ${Math.round(delay)}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
};

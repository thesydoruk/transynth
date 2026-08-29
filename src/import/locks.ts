/**
 * Session-level advisory locking for bulk mod writes (import, CSV/EET import, mod delete).
 *
 * Concurrent bulk writers touching records/strings/translations deadlock in PostgreSQL,
 * so they serialize on one advisory lock instead.
 */
import pg from 'pg';
import type { Tx } from '../db';

const { Pool } = pg;

/** Session advisory lock — serializes bulk writes to records/strings across imports. */
export const MOD_IMPORT_WRITE_ADVISORY_LOCK_KEY = 0x4d6f6457;

/** True for PostgreSQL deadlock error (SQLSTATE 40P01). */
export const isPgDeadlockError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  if ('code' in err && (err as { code?: string }).code === '40P01') return true;
  return err.message.toLowerCase().includes('deadlock');
};

/**
 * Hold an exclusive session lock for the duration of a bulk import.
 * Concurrent mod/EET/CSV imports block here instead of deadlocking in PostgreSQL.
 */
export const withModImportWriteLock = async <T>(db: Tx, fn: () => Promise<T>): Promise<T> => {
  await db.query(`SELECT pg_advisory_lock($1)`, [MOD_IMPORT_WRITE_ADVISORY_LOCK_KEY]);
  try {
    return await fn();
  } finally {
    await db.query(`SELECT pg_advisory_unlock($1)`, [MOD_IMPORT_WRITE_ADVISORY_LOCK_KEY]);
  }
};

/** Hold one pool client for the whole bulk window, so session locks and writes share a session. */
export const pinDbClient = async (
  db: Tx,
): Promise<{ client: pg.PoolClient; release?: () => void }> => {
  if (db instanceof Pool) {
    const client = await db.connect();
    return { client, release: () => client.release() };
  }
  return { client: db as pg.PoolClient };
};

/** Run `fn` on a pinned client while holding the bulk-write advisory lock. */
export const withPinnedModImportWriteLock = async <T>(
  db: Tx,
  fn: (client: Tx) => Promise<T>,
): Promise<T> => {
  const { client, release } = await pinDbClient(db);
  try {
    return await withModImportWriteLock(client, () => fn(client));
  } finally {
    release?.();
  }
};

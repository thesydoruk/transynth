import pg from 'pg';
import { CONFIG } from '../config';
import { log } from '../logger';
import type { Tx } from './types';

const { Pool } = pg;

let _pool: pg.Pool | null = null;

export const openDb = (): pg.Pool => {
  if (!_pool) {
    _pool = new Pool({
      connectionString: CONFIG.databaseUrl,
      max: CONFIG.dbPoolMax,
      keepAlive: true,
      ...(CONFIG.dbStatementTimeoutMs > 0
        ? { statement_timeout: CONFIG.dbStatementTimeoutMs }
        : {}),
      ...(CONFIG.dbIdleInTransactionTimeoutMs > 0
        ? { idle_in_transaction_session_timeout: CONFIG.dbIdleInTransactionTimeoutMs }
        : {}),
    });
    _pool.on('error', (err) => {
      log.error('DB: idle pool client error', err);
    });
    log.info(`DB: connection pool created (max=${CONFIG.dbPoolMax})`);
  }
  return _pool;
};

export const closeDb = async (): Promise<void> => {
  if (_pool) {
    await _pool.end();
    _pool = null;
    log.info('DB: connection pool closed');
  }
};

export const runSchema = async (db: Tx, schemaSql: string): Promise<void> => {
  await db.query(schemaSql);
};

/**
 * Execute a function inside a transaction.
 * Acquires a client, runs BEGIN … COMMIT, releases on completion.
 */
export const withTransaction = async <T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    log.trace('DB: BEGIN transaction');
    const result = await fn(client);
    await client.query('COMMIT');
    log.trace('DB: COMMIT transaction');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    log.warn('DB: ROLLBACK transaction', err);
    throw err;
  } finally {
    client.release();
  }
};

import type pg from 'pg';

/** A Tx is either the Pool (for standalone queries) or a PoolClient (inside a transaction). */
export type Tx = pg.Pool | pg.PoolClient;

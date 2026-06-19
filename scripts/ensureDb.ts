#!/usr/bin/env tsx
import '../src/loadEnv';
import pg from 'pg';
import { parseDatabaseUrl, resolveDatabaseUrl } from '../src/databaseUrl';

/** Create the target database if it does not exist yet (connects to `postgres`). */
export const ensureDatabase = async (): Promise<void> => {
  const { user, password, host, port, database } = parseDatabaseUrl(resolveDatabaseUrl());

  const client = new pg.Client({
    user,
    password,
    host,
    port: parseInt(port, 10),
    database: 'postgres',
  });

  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      database,
    ]);
    if (rowCount === 0) {
      await client.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
      console.log(`Created database "${database}"`);
    }
  } finally {
    await client.end();
  }
};

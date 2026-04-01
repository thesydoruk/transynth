#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import { openDb, runSchema, closeDb } from '../src/db';
import { log } from '../src/logger';

/**
 * Parse CLI arguments and return whether destructive reset is confirmed.
 *
 * This script intentionally requires an explicit `--yes` flag so accidental
 * invocations do not wipe development data.
 */
const isConfirmed = (): boolean => {
  return process.argv.includes('--yes');
};

/**
 * Perform a full development database reset:
 * 1) drop `public` schema with CASCADE,
 * 2) recreate `public` schema,
 * 3) re-apply `sql/schema.sql`.
 */
const resetDatabase = async (): Promise<void> => {
  const schemaPath = path.resolve('sql/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  const db = openDb();
  try {
    log.warn('DB reset: dropping schema public with CASCADE');
    await db.query('DROP SCHEMA public CASCADE;');

    log.info('DB reset: recreating schema public');
    await db.query('CREATE SCHEMA public;');

    log.info('DB reset: applying sql/schema.sql');
    await runSchema(db, schemaSql);
    log.info(`DB reset complete (${process.env.DATABASE_URL ?? 'default connection'})`);
  } finally {
    await closeDb();
  }
};

if (!isConfirmed()) {
  log.error('Refusing to reset DB without explicit confirmation. Re-run with: npm run db:reset -- --yes');
  process.exit(1);
}

await resetDatabase();

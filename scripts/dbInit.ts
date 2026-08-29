#!/usr/bin/env tsx
/**
 * Create the PostgreSQL database (if missing) and apply `sql/schema.sql`.
 *
 * Idempotent: safe to re-run; existing tables are not dropped. There is no
 * numbered migration folder — `sql/schema.sql` is the whole schema. For a full
 * wipe use `npm run db:reset -- --yes`.
 *
 * Usage:
 *   npm run db:init
 *
 * Environment:
 *   DATABASE_URL   PostgreSQL connection string (see .env.example)
 */
import '../src/loadEnv';
import fs from 'fs';
import path from 'path';
import { openDb, runSchema, closeDb } from '../src/db';
import { log } from '../src/logger';
import { ensureDatabase } from './ensureDb';

const schemaPath = path.resolve('sql/schema.sql');
const sql = fs.readFileSync(schemaPath, 'utf8');
await ensureDatabase();
const db = openDb();
await runSchema(db, sql);

log.info(`PostgreSQL schema applied (${process.env.DATABASE_URL ?? 'default connection'})`);
await closeDb();

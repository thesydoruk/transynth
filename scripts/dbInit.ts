#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import { openDb, runSchema, closeDb } from '../src/db.js';
import { log } from '../src/logger.js';

const schemaPath = path.resolve('sql/schema.sql');
const sql = fs.readFileSync(schemaPath, 'utf8');
const db = openDb();
await runSchema(db, sql);

log.info(`PostgreSQL schema applied (${process.env.DATABASE_URL ?? 'default connection'})`);
await closeDb();
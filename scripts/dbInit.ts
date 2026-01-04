#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import { openDb, runSchema } from '../src/db.js';
import { log } from '../src/logger.js';

const schemaPath = path.resolve('sql/schema.sql');
const sql = fs.readFileSync(schemaPath, 'utf8');
const db = openDb();
runSchema(db, sql);

log.info(`SQLite schema applied at ${db.name ?? process.env.DATABASE_PATH ?? './localizer.sqlite'}`);

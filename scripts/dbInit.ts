#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import { openDb, runSchema } from '../src/db.js';

const schemaPath = path.resolve('sql/schema.sql');
const sql = fs.readFileSync(schemaPath, 'utf8');
const db = openDb();
runSchema(db, sql);

console.log('SQLite schema applied at', db.name ?? process.env.DATABASE_PATH ?? './localizer.sqlite');

#!/usr/bin/env tsx
/**
 * Rebuild the RAG embedding index from approved/reviewed translation examples in the DB.
 *
 * Run after bulk imports or when reference-example search returns stale results.
 * No CLI flags.
 *
 * Usage:
 *   npm run rag:reindex
 *
 * Environment:
 *   DATABASE_URL   PostgreSQL connection string
 *   LLM / embedding provider settings (see .env.example)
 */
import '../src/loadEnv';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import { reindexAllTranslationExamples } from '../src/llm/rag';

const db = openDb();
const result = await reindexAllTranslationExamples(db, (done, total) => {
  if (done % 100 === 0 || done === total) {
    log.info(`RAG reindex: ${done}/${total}`);
  }
});
log.info(
  `RAG reindex complete: indexed=${result.indexed}, failed=${result.failed}, removed=${result.skipped}, total=${result.total}`,
);
await closeDb();

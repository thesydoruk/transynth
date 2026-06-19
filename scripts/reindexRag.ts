#!/usr/bin/env tsx
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import { reindexAllTranslationExamples } from '../src/llm/ragService';

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

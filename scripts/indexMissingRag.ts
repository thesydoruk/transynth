#!/usr/bin/env tsx
/**
 * Embed reviewed translations that are not yet in translation_examples.
 *
 * Usage:
 *   npm run rag:index-missing
 */
import '../src/loadEnv';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import { indexMissingTranslationExamples } from '../src/llm/rag/indexMissing';

const db = openDb();
try {
  const started = Date.now();
  let lastLog = 0;
  const result = await indexMissingTranslationExamples(db, (done, total) => {
    const now = Date.now();
    if (done === total || now - lastLog >= 15_000) {
      lastLog = now;
      const rate = done > 0 ? (done / ((now - started) / 1000)).toFixed(1) : '0';
      log.info(`RAG index-missing: ${done}/${total} (${rate}/s)`);
    }
  });
  log.info(
    `RAG index-missing complete: indexed=${result.indexed}, failed=${result.failed}, total=${result.total}`,
  );
} finally {
  await closeDb();
}

/**
 * Schedules asynchronous RAG index updates without blocking API handlers.
 */
import type { Tx } from '../db';
import { log } from '../logger';
import { syncTranslationExample } from '../llm/ragService';

/** Fire-and-forget RAG sync for a single translation row. */
export const scheduleRagSync = (db: Tx, translationId: number): void => {
  void syncTranslationExample(db, translationId).catch((err: unknown) => {
    log.warn({ err, translationId }, 'RAG index sync failed');
  });
};

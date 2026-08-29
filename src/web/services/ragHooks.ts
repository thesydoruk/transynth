/**
 * Schedules asynchronous RAG index updates without blocking API handlers.
 */
import type { Tx } from '../../db';
import { logRag } from '../../logging/loggers';
import { isStaleTranslationRagSyncError, syncTranslationExample } from '../../llm/rag';

/** Fire-and-forget RAG sync for a single translation row. */
export const scheduleRagSync = (db: Tx, translationId: number): void => {
  void syncTranslationExample(db, translationId).catch((err: unknown) => {
    if (isStaleTranslationRagSyncError(err)) return;
    logRag.warn('index sync failed', { err, translationId });
  });
};

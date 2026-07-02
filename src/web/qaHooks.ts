/**
 * Schedules asynchronous QA refresh without blocking LLM translate persist.
 */
import type { Tx } from '../db';
import { log } from '../logger';
import { refreshQAIssuesBatch } from './queries';

/** Fire-and-forget batch QA recompute for auto-translated strings. */
export const scheduleRefreshQAIssuesBatch = (
  db: Tx,
  stringIds: number[],
  targetLang: string,
  srcLang: string,
): void => {
  if (stringIds.length === 0) return;
  void refreshQAIssuesBatch(db, stringIds, targetLang, srcLang).catch((err: unknown) => {
    log.warn('QA batch refresh failed', {
      err,
      stringCount: stringIds.length,
      targetLang,
      srcLang,
    });
  });
};

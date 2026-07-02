/**
 * Coalesced async QA refresh for LLM auto-translate — avoids one heavy SELECT
 * storm per LLM chunk competing with the translate pipeline.
 */
import type { Tx } from '../db';
import { log } from '../logger';
import { refreshQAIssuesBatch } from './queries';

/** Debounce window: merge chunk writes before running QA SQL. */
const QA_FLUSH_DELAY_MS = 1_500;

/** Max string IDs per QA refresh pass. */
const QA_MAX_BATCH_SIZE = 300;

type QaRefreshQueue = {
  db: Tx;
  targetLang: string;
  srcLang: string;
  ids: Set<number>;
  timer: ReturnType<typeof setTimeout> | null;
};

let queue: QaRefreshQueue | null = null;
/** Serializes QA drains so only one refresh runs at a time. */
let drainTail: Promise<void> = Promise.resolve();

const queueKey = (srcLang: string, targetLang: string): string => `${srcLang}\0${targetLang}`;

const drainOnce = async (): Promise<void> => {
  const q = queue;
  if (!q || q.ids.size === 0) return;

  const batch = [...q.ids].slice(0, QA_MAX_BATCH_SIZE);
  for (const id of batch) q.ids.delete(id);

  try {
    await refreshQAIssuesBatch(q.db, batch, q.targetLang, q.srcLang, {
      skipDuplicateCheck: true,
    });
  } catch (err: unknown) {
    log.warn('QA batch refresh failed', {
      err,
      stringCount: batch.length,
      targetLang: q.targetLang,
      srcLang: q.srcLang,
    });
  }

  if (q.ids.size > 0) {
    await drainOnce();
  } else if (queue === q) {
    queue = null;
  }
};

const scheduleDrain = (): void => {
  drainTail = drainTail
    .then(() => drainOnce())
    .catch((err: unknown) => {
      log.warn('QA drain chain failed', { err });
    });
};

const flushSoon = (): void => {
  if (!queue) return;
  if (queue.timer) clearTimeout(queue.timer);
  queue.timer = setTimeout(() => {
    if (queue) queue.timer = null;
    scheduleDrain();
  }, QA_FLUSH_DELAY_MS);
};

/** Queue string IDs for debounced QA refresh (auto-translate only). */
export const scheduleRefreshQAIssuesBatch = (
  db: Tx,
  stringIds: number[],
  targetLang: string,
  srcLang: string,
): void => {
  if (stringIds.length === 0) return;

  const key = queueKey(srcLang, targetLang);
  if (
    queue &&
    queueKey(queue.srcLang, queue.targetLang) !== key &&
    (queue.ids.size > 0 || queue.timer != null)
  ) {
    void awaitPendingQaRefresh();
  }

  if (!queue) {
    queue = { db, targetLang, srcLang, ids: new Set(), timer: null };
  } else {
    queue.db = db;
    queue.targetLang = targetLang;
    queue.srcLang = srcLang;
  }

  for (const id of stringIds) queue.ids.add(id);
  flushSoon();
};

/** Flush all pending QA refreshes — call when a translate job finishes. */
export const awaitPendingQaRefresh = async (): Promise<void> => {
  if (queue?.timer) {
    clearTimeout(queue.timer);
    queue.timer = null;
  }
  if (queue && queue.ids.size > 0) {
    scheduleDrain();
  }
  await drainTail;
};

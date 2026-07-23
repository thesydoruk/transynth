import type { Tx } from '../../db';
import { CONFIG, getEmbedModel } from '../../config';
import { logRag } from '../../logging/loggers';
import { RAG_ELIGIBLE_STATUSES_SQL, RAG_EMBED_DIMENSIONS } from '../ragConstants';
import { mapWithConcurrency } from '../../utils/concurrency';
import type { RagStats, ReindexResult } from './types';
import { isPgvectorAvailable } from './pgvector';
import { syncTranslationExample } from './sync';

/** Rebuild the full RAG index from all eligible translations. */
export const reindexAllTranslationExamples = async (
  db: Tx,
  onProgress?: (done: number, total: number) => void,
): Promise<ReindexResult> => {
  if (!(await isPgvectorAvailable(db))) {
    throw new Error('pgvector extension is not available — cannot reindex RAG examples');
  }

  const { rows } = await db.query<{ id: number }>(
    `SELECT t.id FROM translations t
     WHERE t.status IN (${RAG_ELIGIBLE_STATUSES_SQL})
     ORDER BY t.id`,
  );

  const total = rows.length;
  let indexed = 0;
  let failed = 0;
  let progressDone = 0;

  await mapWithConcurrency(rows, CONFIG.embedMaxParallel, async (row) => {
    try {
      await syncTranslationExample(db, row.id);
      indexed++;
    } catch (err) {
      logRag.error('RAG reindex failed for translation', { err, translationId: row.id });
      failed++;
    }
    progressDone++;
    onProgress?.(progressDone, total);
  });

  const { rowCount } = await db.query(
    `DELETE FROM translation_examples te
     WHERE NOT EXISTS (
       SELECT 1 FROM translations t
       WHERE t.id = te.translation_id AND t.status IN (${RAG_ELIGIBLE_STATUSES_SQL})
     )`,
  );
  const removed = rowCount ?? 0;

  return { indexed, skipped: removed, failed, total };
};

/** Aggregate RAG index statistics for the ops dashboard. */
export const getRagStats = async (db: Tx): Promise<RagStats> => {
  const pgvectorAvailable = await isPgvectorAvailable(db);
  const { rows: countRows } = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM translation_examples`,
  );
  const { rows: eligibleRows } = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM translations WHERE status IN (${RAG_ELIGIBLE_STATUSES_SQL})`,
  );

  return {
    pgvectorAvailable,
    indexedCount: countRows[0]?.count ?? 0,
    eligibleCount: eligibleRows[0]?.count ?? 0,
    embedModel: getEmbedModel(),
    embedDimensions: RAG_EMBED_DIMENSIONS,
  };
};

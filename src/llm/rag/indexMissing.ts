import type { Tx } from '../../db';
import { CONFIG, getEmbedModel } from '../../config';
import { logRag } from '../../logging/loggers';
import { RAG_ELIGIBLE_STATUSES_SQL } from '../ragConstants';
import { mapWithConcurrency } from '../../utils/concurrency';
import type { ReindexResult, TranslationRow } from './types';
import { isPgvectorAvailable } from './pgvector';
import { buildEmbeddingInput, embedTextsForRagResilient, vectorLiteral } from './embedding';
import { isStaleTranslationRagSyncError } from './sync';

const MISSING_PAGE = 256;

type MissingRow = TranslationRow;

const loadMissingPage = async (db: Tx, afterId: number, limit: number): Promise<MissingRow[]> => {
  const { rows } = await db.query<MissingRow>(
    `SELECT t.id AS translation_id, t.src_string_id, s.lang AS src_lang,
            t.target_lang, s.text_raw AS source_text, t.text AS translation_text,
            r.signature, r.path, s.context, m.game, s.text_norm, s.text_norm_nopunct,
            t.status
     FROM translations t
     JOIN strings s ON s.id = t.src_string_id
     JOIN records r ON r.id = s.record_id
     JOIN mods m ON m.id = r.mod_id
     WHERE t.status IN (${RAG_ELIGIBLE_STATUSES_SQL})
       AND t.id > $1
       AND NOT EXISTS (
         SELECT 1 FROM translation_examples te WHERE te.translation_id = t.id
       )
     ORDER BY t.id
     LIMIT $2`,
    [afterId, limit],
  );
  return rows;
};

const upsertExample = async (
  db: Tx,
  row: MissingRow,
  embedding: number[],
  model: string,
): Promise<boolean> => {
  const literal = vectorLiteral(embedding);
  try {
    const result = await db.query(
      `INSERT INTO translation_examples(
         translation_id, src_string_id, src_lang, target_lang,
         source_text, translation_text, signature, path, game,
         embed_model, embedding, updated_at
       )
       SELECT t.id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector, NOW()
       FROM translations t
       WHERE t.id = $1 AND t.status IN (${RAG_ELIGIBLE_STATUSES_SQL})
       ON CONFLICT (translation_id) DO UPDATE SET
         src_string_id = EXCLUDED.src_string_id,
         src_lang = EXCLUDED.src_lang,
         target_lang = EXCLUDED.target_lang,
         source_text = EXCLUDED.source_text,
         translation_text = EXCLUDED.translation_text,
         signature = EXCLUDED.signature,
         path = EXCLUDED.path,
         game = EXCLUDED.game,
         embed_model = EXCLUDED.embed_model,
         embedding = EXCLUDED.embedding,
         updated_at = NOW()`,
      [
        row.translation_id,
        row.src_string_id,
        row.src_lang,
        row.target_lang,
        row.source_text,
        row.translation_text,
        row.signature,
        row.path,
        row.game,
        model,
        literal,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    if (isStaleTranslationRagSyncError(err)) return false;
    throw err;
  }
};

/** Index only reviewed translations that have no translation_examples row yet. */
export const indexMissingTranslationExamples = async (
  db: Tx,
  onProgress?: (done: number, total: number) => void,
): Promise<ReindexResult> => {
  if (!(await isPgvectorAvailable(db))) {
    throw new Error('pgvector extension is not available — cannot index RAG examples');
  }

  const { rows: countRows } = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM translations t
     WHERE t.status IN (${RAG_ELIGIBLE_STATUSES_SQL})
       AND NOT EXISTS (
         SELECT 1 FROM translation_examples te WHERE te.translation_id = t.id
       )`,
  );
  const total = countRows[0]?.count ?? 0;
  if (total === 0) {
    onProgress?.(0, 0);
    return { indexed: 0, skipped: 0, failed: 0, total: 0 };
  }

  const model = getEmbedModel();
  const embedBatchSize = CONFIG.ragEmbedBatchSize;
  let afterId = 0;
  let indexed = 0;
  let failed = 0;
  let progressDone = 0;

  for (;;) {
    const page = await loadMissingPage(db, afterId, MISSING_PAGE);
    if (page.length === 0) break;
    afterId = page[page.length - 1]!.translation_id;

    const chunks: MissingRow[][] = [];
    for (let i = 0; i < page.length; i += embedBatchSize) {
      chunks.push(page.slice(i, i + embedBatchSize));
    }

    const chunkResults = await mapWithConcurrency(
      chunks,
      CONFIG.embedMaxParallel,
      async (chunk) => {
        let chunkIndexed = 0;
        let chunkFailed = 0;
        try {
          const texts = chunk.map((row) =>
            buildEmbeddingInput({
              sourceText: row.source_text,
              signature: row.signature,
              path: row.path,
              context: row.context,
            }),
          );
          const vectors = await embedTextsForRagResilient(texts);
          for (let i = 0; i < chunk.length; i++) {
            const row = chunk[i]!;
            const vec = vectors[i];
            if (!vec) {
              chunkFailed += 1;
              continue;
            }
            try {
              const ok = await upsertExample(db, row, vec, model);
              if (ok) chunkIndexed += 1;
              else chunkFailed += 1;
            } catch (err) {
              chunkFailed += 1;
              logRag.error('RAG missing-index upsert failed', {
                err,
                translationId: row.translation_id,
              });
            }
          }
        } catch (err) {
          chunkFailed += chunk.length;
          logRag.error('RAG missing-index embed batch failed', {
            err,
            fromId: chunk[0]?.translation_id,
            toId: chunk[chunk.length - 1]?.translation_id,
            size: chunk.length,
          });
        }
        return { chunkIndexed, chunkFailed, size: chunk.length };
      },
    );

    for (const r of chunkResults) {
      indexed += r.chunkIndexed;
      failed += r.chunkFailed;
      progressDone += r.size;
      onProgress?.(progressDone, total);
    }
  }

  return { indexed, skipped: 0, failed, total };
};

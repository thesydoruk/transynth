import type { Tx } from '../../db';
import { getEmbedModel } from '../../config';
import { logRag } from '../../logging/loggers';
import {
  RAG_ELIGIBLE_STATUSES,
  RAG_ELIGIBLE_STATUSES_SQL,
  type RagEligibleStatus,
} from '../ragConstants';
import type { TranslationRow } from './types';
import { isPgvectorAvailable } from './pgvector';
import { buildEmbeddingInput, embedTextsForRag, vectorLiteral } from './embedding';

/** True when a concurrent delete/replace removed the translation before index upsert. */
export const isStaleTranslationRagSyncError = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'code' in err &&
  (err as { code: string }).code === '23503';

const loadTranslationRow = async (
  db: Tx,
  translationId: number,
): Promise<TranslationRow | null> => {
  const { rows } = await db.query<TranslationRow>(
    `SELECT t.id AS translation_id, t.src_string_id, s.lang AS src_lang,
            t.target_lang, s.text_raw AS source_text, t.text AS translation_text,
            r.signature, r.path, s.context, m.game, s.text_norm, s.text_norm_nopunct,
            t.status
     FROM translations t
     JOIN strings s ON s.id = t.src_string_id
     JOIN records r ON r.id = s.record_id
     JOIN mods m ON m.id = r.mod_id
     WHERE t.id = $1`,
    [translationId],
  );
  return rows[0] ?? null;
};

/**
 * Upsert or remove a translation in the RAG index based on its current status.
 */
export const syncTranslationExample = async (db: Tx, translationId: number): Promise<void> => {
  const row = await loadTranslationRow(db, translationId);
  if (!row) return;

  if (!RAG_ELIGIBLE_STATUSES.includes(row.status as RagEligibleStatus)) {
    await db.query(`DELETE FROM translation_examples WHERE translation_id = $1`, [translationId]);
    return;
  }

  if (!(await isPgvectorAvailable(db))) {
    logRag.warn('RAG sync skipped: pgvector extension is not available', { translationId });
    return;
  }

  const embedInput = buildEmbeddingInput({
    sourceText: row.source_text,
    signature: row.signature,
    path: row.path,
    context: row.context,
  });
  const [embedding] = await embedTextsForRag([embedInput]);
  const model = getEmbedModel();
  const literal = vectorLiteral(embedding);

  // Embedding is slow; bulk upserts (e.g. mod import) may delete/replace this row meanwhile.
  const current = await loadTranslationRow(db, translationId);
  if (!current || !RAG_ELIGIBLE_STATUSES.includes(current.status as RagEligibleStatus)) {
    await db.query(`DELETE FROM translation_examples WHERE translation_id = $1`, [translationId]);
    return;
  }

  try {
    await db.query(
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
        translationId,
        current.src_string_id,
        current.src_lang,
        current.target_lang,
        current.source_text,
        current.translation_text,
        current.signature,
        current.path,
        current.game,
        model,
        literal,
      ],
    );
  } catch (err) {
    if (isStaleTranslationRagSyncError(err)) return;
    throw err;
  }
};

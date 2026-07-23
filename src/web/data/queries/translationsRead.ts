import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { log } from '../../../logger';
import { findReferenceExamples, type RagReferenceExample } from '../../../llm/rag';

export const getRagSuggestions = async (
  db: Tx,
  stringId: number,
  targetLang: string,
  limit = 10,
): Promise<RagReferenceExample[]> => {
  const { rows } = await db.query<{
    text_raw: string;
    text_norm: string | null;
    text_norm_nopunct: string | null;
    lang: string;
    context: string | null;
    signature: string | null;
    path: string | null;
  }>(
    `SELECT s.text_raw, s.text_norm, s.text_norm_nopunct, s.lang, s.context,
            r.signature, r.path
     FROM strings s
     JOIN records r ON r.id = s.record_id
     WHERE s.id = $1`,
    [stringId],
  );
  const row = rows[0];
  if (!row?.text_raw) return [];

  try {
    return await findReferenceExamples(db, {
      stringId,
      sourceText: row.text_raw,
      textNorm: row.text_norm,
      textNormNopunct: row.text_norm_nopunct,
      signature: row.signature,
      path: row.path,
      context: row.context,
      srcLang: row.lang,
      targetLang,
      maxExamples: limit,
    });
  } catch (err) {
    log.warn(`RAG suggestions unavailable for string ${stringId}: ${(err as Error).message}`);
    return [];
  }
};

// Returns text_norm for a string ID (used by propagation)
export const getStringTextNorm = async (db: Tx, stringId: number): Promise<string | null> => {
  const { rows } = await db.query(`SELECT text_norm FROM strings WHERE id = $1`, [stringId]);
  return rows[0]?.text_norm ?? null;
};

export const getTranslationHistory = async (
  db: Tx,
  stringId: number,
  targetLang = CONFIG.defaultTgtLang,
) => {
  const { rows } = await db.query(
    `SELECT id, translation_id, text, status, provenance, model, note, created_at
     FROM translation_revisions
     WHERE src_string_id = $1 AND target_lang = $2
     ORDER BY created_at DESC, id DESC
     LIMIT 25`,
    [stringId, targetLang],
  );
  return rows;
};

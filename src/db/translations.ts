import type { Tx } from './types';

export const addTranslation = async (
  db: Tx,
  srcStringId: number,
  targetLang: string,
  text: string,
  status: string,
  confidence: number | null,
  provenance: string,
  model?: string,
): Promise<number> => {
  const { rows } = await db.query(
    `INSERT INTO translations(src_string_id, target_lang, text, status, confidence, provenance, model)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(src_string_id, target_lang) DO UPDATE SET
       text = EXCLUDED.text,
       status = EXCLUDED.status,
       confidence = EXCLUDED.confidence,
       provenance = EXCLUDED.provenance,
       model = EXCLUDED.model,
       updated_at = NOW()
     RETURNING id`,
    [srcStringId, targetLang, text, status, confidence, provenance, model ?? null],
  );
  return rows[0].id;
};

export const bestTranslation = async (
  db: Tx,
  srcStringId: number,
  targetLang: string,
): Promise<{ id: number; text: string; status: string } | undefined> => {
  const { rows } = await db.query(
    `SELECT id, text, status FROM translations
     WHERE src_string_id = $1 AND target_lang = $2
     ORDER BY CASE status
       WHEN 'human' THEN 1
       WHEN 'tm'    THEN 2
       WHEN 'fuzzy' THEN 3
       WHEN 'auto'  THEN 4
       ELSE 5 END,
       COALESCE(confidence, 0) DESC,
       created_at DESC
     LIMIT 1`,
    [srcStringId, targetLang],
  );
  return rows[0];
};

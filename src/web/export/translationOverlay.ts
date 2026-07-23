import type { Tx } from '../../db';

/**
 * Build an overlay map of `lstring_id → export_text` for a mod and language pair.
 *
 * The query selects one "best" translation per source string according to
 * status and confidence, then falls back to the original source text when no
 * translation exists. The result can be applied to each source strings table
 * via {@link patchStringsMap}.
 *
 * @param db - Database transaction/pool wrapper.
 * @param modId - Mod identifier.
 * @param srcLang - Source language code of the stored strings rows.
 * @param targetLang - Desired target language code.
 * @returns Map keyed by `lstring_id` containing the chosen export text.
 */
export const getTranslationOverlay = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<Map<number, string>> => {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (s.lstring_id)
        s.lstring_id,
        COALESCE(t.text, s.text_raw) AS export_text
     FROM strings s
     JOIN records r ON r.id = s.record_id
     LEFT JOIN translations t
       ON t.src_string_id = s.id AND t.target_lang = $3
       AND t.id = (
         SELECT id FROM translations
         WHERE src_string_id = s.id AND target_lang = $3
         ORDER BY CASE status
           WHEN 'draft' THEN 1
           WHEN 'reviewed' THEN 2
           WHEN 'human' THEN 3
           WHEN 'tm' THEN 4
           WHEN 'fuzzy' THEN 5
           WHEN 'auto' THEN 6
           WHEN 'rejected' THEN 7
           ELSE 8 END,
           COALESCE(confidence, 0) DESC,
           updated_at DESC
         LIMIT 1
       )
     WHERE r.mod_id = $1 AND s.lang = $2 AND s.lstring_id IS NOT NULL
     ORDER BY s.lstring_id, s.created_at DESC`,
    [modId, srcLang, targetLang],
  );

  const overlay = new Map<number, string>();
  for (const row of rows as Array<{ lstring_id: number; export_text: string }>) {
    overlay.set(row.lstring_id, row.export_text);
  }
  return overlay;
};

export const hasTranslationOverlayChanges = (
  sourceMap: Map<number, string>,
  overlay: Map<number, string>,
): boolean => {
  for (const [id, srcText] of sourceMap) {
    const exportText = overlay.get(id);
    if (exportText !== undefined && exportText !== srcText) return true;
  }
  return false;
};

import type { Tx } from '../db';

export type VoiceTranslationRow = {
  formidLower6: string;
  infoFormidHex: string;
  translation: string;
  source: string;
};

const bestTranslationOrder = (statusColumn: string): string => `CASE ${statusColumn}
  WHEN 'skip' THEN 0
  WHEN 'draft' THEN 1
  WHEN 'reviewed' THEN 2
  WHEN 'human' THEN 3
  WHEN 'tm' THEN 4
  WHEN 'fuzzy' THEN 5
  WHEN 'auto' THEN 6
  WHEN 'rejected' THEN 7
  ELSE 8 END`;

/**
 * Load best available translated dialogue lines keyed by INFO FormID (lower 6 hex).
 */
export const loadVoiceTranslations = async (
  db: Tx,
  modId: number,
  srcLang: string,
  tgtLang: string,
): Promise<Map<string, VoiceTranslationRow>> => {
  const { rows } = await db.query<{
    formid_lower6: string;
    info_formid_hex: string;
    translation: string;
    source: string;
  }>(
    `SELECT DISTINCT ON (UPPER(SUBSTRING(dn.info_formid_hex FROM 3)))
        UPPER(SUBSTRING(dn.info_formid_hex FROM 3)) AS formid_lower6,
        dn.info_formid_hex,
        t.text AS translation,
        s.text_raw AS source
     FROM dialog_nodes dn
     JOIN dialog_topics dt ON dt.id = dn.topic_id AND dt.mod_id = $1
     JOIN strings s ON s.id = dn.response_string_id AND s.lang = $2
     JOIN LATERAL (
       SELECT text, status
       FROM translations
       WHERE src_string_id = s.id AND target_lang = $3
       ORDER BY ${bestTranslationOrder('status')}, COALESCE(confidence, 0) DESC, created_at DESC
       LIMIT 1
     ) t ON TRUE
     WHERE t.text IS NOT NULL AND BTRIM(t.text) <> ''
     ORDER BY UPPER(SUBSTRING(dn.info_formid_hex FROM 3)), ${bestTranslationOrder('t.status')} DESC`,
    [modId, srcLang, tgtLang],
  );

  const map = new Map<string, VoiceTranslationRow>();
  for (const row of rows) {
    map.set(row.formid_lower6, {
      formidLower6: row.formid_lower6,
      infoFormidHex: row.info_formid_hex,
      translation: row.translation,
      source: row.source,
    });
  }
  return map;
};

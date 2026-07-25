/**
 * Shared SQL for resolving the text of a dialog INFO record.
 *
 * Dialog nodes store graph structure only. Their text lives in `records` /
 * `strings` and is resolved per query, which keeps spoken responses (NAM1) and
 * player prompts (RNAM) apart and supports INFOs that hold several responses.
 */

/** `records.path_simplified` of a spoken INFO response. */
export const DIALOG_RESPONSE_PATH = 'INFO\\NAM1';

/** `records.path_simplified` of the player prompt shown for an INFO. */
export const DIALOG_PROMPT_PATH = 'INFO\\RNAM';

/** One translatable line of an INFO record. */
export type DialogLine = {
  kind: 'response' | 'prompt';
  string_id: number;
  source: string;
  context: string | null;
  translation_id: number | null;
  translation: string | null;
  status: string | null;
  confidence: number | null;
  provenance: string | null;
  model: string | null;
  updated_at: string | null;
  qa_issue_count: number;
};

/**
 * Build a `LEFT JOIN LATERAL` body that aggregates every line of the INFO
 * record referenced by `dn.info_formid_hex` inside the mod owning `dt`.
 *
 * Prompts sort before responses so a line reads in the order the player sees it.
 *
 * @param p - Placeholders of the enclosing query, e.g. `{ srcLang: '$2' }`.
 */
export const dialogLinesLateralSql = (p: {
  srcLang: string;
  targetLang: string;
  responsePath: string;
  promptPath: string;
}): string => `
    SELECT json_agg(
             json_build_object(
               'kind', CASE WHEN r.path_simplified = ${p.promptPath} THEN 'prompt' ELSE 'response' END,
               'string_id', s.id,
               'source', s.text_raw,
               'context', s.context,
               'translation_id', t.id,
               'translation', t.text,
               'status', t.status,
               'confidence', t.confidence,
               'provenance', t.provenance,
               'model', t.model,
               'updated_at', t.updated_at,
               'qa_issue_count', (
                 SELECT COUNT(*)::int
                 FROM qa_issues qi
                 WHERE qi.src_string_id = s.id
                   AND qi.target_lang = ${p.targetLang}
                   AND qi.is_active = TRUE
               )
             )
             ORDER BY CASE WHEN r.path_simplified = ${p.promptPath} THEN 0 ELSE 1 END, s.id
           ) AS lines
    FROM records r
    JOIN strings s
      ON s.record_id = r.id
     AND s.lang = ${p.srcLang}
    LEFT JOIN translations t
      ON t.src_string_id = s.id
     AND t.target_lang = ${p.targetLang}
    WHERE r.mod_id = dt.mod_id
      AND r.signature = 'INFO'
      AND r.formid_hex = dn.info_formid_hex
      AND r.path_simplified IN (${p.responsePath}, ${p.promptPath})`;

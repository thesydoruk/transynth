/**
 * Shared SQL for resolving the text of a dialog INFO record.
 *
 * Dialog nodes store graph structure only. Their text lives in `records` /
 * `strings` and is resolved per query, which keeps spoken responses (NAM1) and
 * player prompts (RNAM) apart and supports INFOs that hold several responses.
 */
import {
  voiceVariantFromOrdinal,
  type InfoVoiceResponseMap,
} from '../../../../voice/infoResponseNumbers';

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
  /**
   * Voice-file response number for `<FormID>_<N>.fuz`, or null for prompts.
   *
   * SQL emits the NAM1 ordinal (`ROW_NUMBER`); callers remap via
   * {@link remapDialogLineVoiceVariants} using FO4 `TRDA` response numbers.
   */
  voice_variant: number | null;
};

/** Remap dialog `voice_variant` from NAM1 ordinal to TRDA / `.fuz` response#. */
export const remapDialogLineVoiceVariants = (
  infoFormidHex: string | null | undefined,
  lines: DialogLine[],
  responseMap: InfoVoiceResponseMap | null | undefined,
): DialogLine[] => {
  if (!responseMap || !infoFormidHex || lines.length === 0) return lines;
  const responses = responseMap.get(infoFormidHex.toUpperCase());
  if (!responses?.length) return lines;
  return lines.map((line) => {
    if (line.kind !== 'response' || line.voice_variant == null) return line;
    const voice_variant = voiceVariantFromOrdinal(line.voice_variant, responses);
    return voice_variant === line.voice_variant ? line : { ...line, voice_variant };
  });
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
    SELECT json_agg(l.line ORDER BY l.prompt_first, l.string_id) AS lines
    FROM (
      SELECT
        CASE WHEN r.path_simplified = ${p.promptPath} THEN 0 ELSE 1 END AS prompt_first,
        s.id AS string_id,
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
          'voice_variant', CASE
            WHEN r.path_simplified = ${p.responsePath}
              THEN (ROW_NUMBER() OVER (PARTITION BY r.id ORDER BY s.id))::int
          END,
          'qa_issue_count', (
            SELECT COUNT(*)::int
            FROM qa_issues qi
            WHERE qi.src_string_id = s.id
              AND qi.target_lang = ${p.targetLang}
              AND qi.is_active = TRUE
          )
        ) AS line
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
        AND r.path_simplified IN (${p.responsePath}, ${p.promptPath})
    ) l`;

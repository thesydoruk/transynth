/**
 * The one SQL statement behind bulk translation-memory matching.
 *
 * Parameters: $1 string ids, $2 formid_hex, $3 path, $4 edid, $5 text_norm,
 * $6 text_raw (all arrays, one entry per target), $7 the mod being filled,
 * $8 target language, $9 source language, $10 reference game key.
 *
 * Each method (anchor → edid → text_norm) looks in the per-game reference base
 * and in other imported mods. An identical source text wins over every inexact
 * one regardless of method, and an inexact anchor/edid hit is skipped when the
 * anchor holds several sibling texts.
 */
const TM_TRANSLATION_STATUS_ORDER = `CASE tr.status
  WHEN 'reviewed' THEN 1
  WHEN 'human' THEN 2
  WHEN 'tm' THEN 3
  WHEN 'fuzzy' THEN 4
  WHEN 'auto' THEN 5
  WHEN 'draft' THEN 6
  ELSE 7 END`;

/**
 * Rank candidates inside one (target, method) partition: an identical source
 * text first, then status.
 */
const TM_CANDIDATE_ORDER = `ORDER BY CASE WHEN s.text_raw = t.text_raw THEN 0 ELSE 1 END,
                    ${TM_TRANSLATION_STATUS_ORDER},
                    COALESCE(tr.confidence, 0) DESC,
                    tr.updated_at DESC`;

const TM_REFERENCE_ORDER = `ORDER BY CASE WHEN rt.source_text = t.text_raw THEN 0 ELSE 1 END,
                    rt.updated_at DESC`;

/**
 * True when an anchor (FormID + path, or EDID + path) carries several different
 * source texts: a record that repeats one subrecord (INFO NAM1, BPTD BPTN, TERM
 * ITXT). A match there that is not the exact text is a *sibling*, not an
 * earlier wording of the target, and must not be copied.
 */
const siblingsSql = (textNorm: string): string =>
  `MIN(${textNorm}) OVER (PARTITION BY t.id) <> MAX(${textNorm}) OVER (PARTITION BY t.id)`;
const REFERENCE_SIBLINGS = siblingsSql('rt.text_norm');
const LIVE_SIBLINGS = siblingsSql('s.text_norm');

/**
 * Best candidate per target. Returns `target_id, text, match_source,
 * source_mod_id, from_reference, method`.
 */
export const TM_MATCH_SQL = `WITH targets AS (
      SELECT *
      FROM UNNEST($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
        AS u(id, formid_hex, path, edid, text_norm, text_raw)
    ),
    reference AS (
      SELECT t.id AS target_id, rt.translation AS text, rt.source_text AS match_source,
        1 AS method_rank, ${REFERENCE_SIBLINGS} AS siblings,
        ROW_NUMBER() OVER (PARTITION BY t.id ${TM_REFERENCE_ORDER}) AS rn
      FROM targets t
      JOIN reference_translations rt
        ON rt.game = $10 AND rt.src_lang = $9 AND rt.tgt_lang = $8
       AND rt.formid_hex = t.formid_hex AND rt.path = t.path
      WHERE NULLIF(t.formid_hex, '') IS NOT NULL

      UNION ALL

      SELECT t.id, rt.translation, rt.source_text, 2, ${REFERENCE_SIBLINGS},
        ROW_NUMBER() OVER (PARTITION BY t.id ${TM_REFERENCE_ORDER}) AS rn
      FROM targets t
      JOIN reference_translations rt
        ON rt.game = $10 AND rt.src_lang = $9 AND rt.tgt_lang = $8
       AND rt.edid = t.edid AND rt.path = t.path
      WHERE NULLIF(t.edid, '') IS NOT NULL

      UNION ALL

      SELECT t.id, rt.translation, rt.source_text, 3, FALSE,
        ROW_NUMBER() OVER (PARTITION BY t.id ${TM_REFERENCE_ORDER}) AS rn
      FROM targets t
      JOIN reference_translations rt
        ON rt.game = $10 AND rt.src_lang = $9 AND rt.tgt_lang = $8
       AND rt.text_norm = t.text_norm
      WHERE NULLIF(t.text_norm, '') IS NOT NULL
    ),
    live AS (
      SELECT t.id AS target_id, tr.text, s.text_raw AS match_source, r.mod_id AS source_mod_id,
        1 AS method_rank, ${LIVE_SIBLINGS} AS siblings,
        ROW_NUMBER() OVER (PARTITION BY t.id ${TM_CANDIDATE_ORDER}) AS rn
      FROM targets t
      JOIN records r
        ON r.formid_hex = t.formid_hex
       AND r.path = t.path
       AND r.mod_id != $7
      JOIN strings s ON s.record_id = r.id AND s.lang = $9
      JOIN translations tr ON tr.src_string_id = s.id AND tr.target_lang = $8
      WHERE NULLIF(t.formid_hex, '') IS NOT NULL

      UNION ALL

      SELECT t.id, tr.text, s.text_raw, r.mod_id, 2, ${LIVE_SIBLINGS},
        ROW_NUMBER() OVER (PARTITION BY t.id ${TM_CANDIDATE_ORDER}) AS rn
      FROM targets t
      JOIN records r ON r.edid = t.edid AND r.mod_id != $7
      JOIN strings s ON s.record_id = r.id AND s.lang = $9
      JOIN translations tr ON tr.src_string_id = s.id AND tr.target_lang = $8
      WHERE NULLIF(t.edid, '') IS NOT NULL

      UNION ALL

      SELECT t.id, tr.text, s.text_raw, r.mod_id, 3, FALSE,
        ROW_NUMBER() OVER (PARTITION BY t.id ${TM_CANDIDATE_ORDER}) AS rn
      FROM targets t
      JOIN strings s ON s.text_norm = t.text_norm AND s.lang = $9
      JOIN translations tr ON tr.src_string_id = s.id AND tr.target_lang = $8
      JOIN records r ON r.id = s.record_id
      WHERE NULLIF(t.text_norm, '') IS NOT NULL
    ),
    best_per_method AS (
      -- Inside one method the reference base (source_rank 0) beats live mods,
      -- unless a live mod has the identical source text and the reference
      -- row does not: exactness still comes first. An inexact hit on an
      -- anchor that holds several sibling texts is dropped altogether.
      SELECT DISTINCT ON (c.target_id, c.method_rank)
        c.target_id, c.text, c.match_source, c.source_mod_id, c.method_rank, c.source_rank,
        (c.match_source = t.text_raw) AS exact
      FROM (
        SELECT target_id, text, match_source, NULL::int AS source_mod_id, method_rank,
               0 AS source_rank, siblings
        FROM reference WHERE rn = 1
        UNION ALL
        SELECT target_id, text, match_source, source_mod_id, method_rank, 1, siblings
        FROM live WHERE rn = 1
      ) c
      JOIN targets t ON t.id = c.target_id
      WHERE c.match_source = t.text_raw OR NOT c.siblings
      ORDER BY c.target_id, c.method_rank,
               CASE WHEN c.match_source = t.text_raw THEN 0 ELSE 1 END,
               c.source_rank
    )
    -- Any exact source text beats any inexact one, whatever the method: an
    -- anchor whose wording differs is only a fallback once nothing identical
    -- exists anywhere.
    SELECT DISTINCT ON (b.target_id)
      b.target_id, b.text, b.match_source, b.source_mod_id,
      (b.source_rank = 0) AS from_reference,
      CASE b.method_rank
        WHEN 1 THEN 'anchor'
        WHEN 2 THEN 'edid'
        ELSE 'text_norm'
      END AS method
    FROM best_per_method b
    ORDER BY b.target_id, b.exact DESC, b.method_rank`;

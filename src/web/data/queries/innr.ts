import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { BEST_TRANSLATION_ORDER } from './constants';

// ── INNR editor ───────────────────────────────────────────────────────────────

/**
 * One component row within an INNR naming rule group.
 *
 * Fallout 4 Instance Naming Rules consist of multiple FormIDs grouped by a
 * shared EDID prefix (e.g. "ArmorMaterialSteel") with a numeric suffix
 * distinguishing individual slots (e.g. "001", "002").  Each slot provides
 * the component text string (FULL subrecord) that the game assembles into the
 * final item name.
 */
export type InnrRow = {
  string_id: number;
  formid_hex: string;
  /** Full EDID including numeric suffix, e.g. "ArmorMaterialSteel001". */
  edid: string | null;
  /** English source text (FULL subrecord). */
  source: string;
  translation_id: number | null;
  translation: string | null;
  status: string | null;
  confidence: number | null;
  qa_issue_count: number;
};

/**
 * A group of INNR component rows sharing the same base EDID prefix.
 *
 * Translators must see all slots of a naming rule together to maintain
 * grammatical agreement between component parts (material, quality, type, etc.).
 */
export type InnrGroup = {
  /** Base EDID without the numeric suffix (e.g. "ArmorMaterialSteel"). */
  base_edid: string;
  rows: InnrRow[];
};

/** Result returned by `listInnrGroups()`. */
export type InnrResult = {
  mod_id: number;
  mod_name: string;
  total_rows: number;
  groups: InnrGroup[];
};

/**
 * Fetches all INNR strings for a given mod, grouped by base EDID prefix.
 *
 * The grouping key is derived by stripping the trailing digit sequence from
 * each EDID, matching a heuristic approach for assembling compound
 * naming-rule component sets.
 *
 * Results are ordered by base EDID then by EDID (natural sort for suffix).
 *
 * @param db         - Database connection or pool.
 * @param modId      - Mod ID to query.
 * @param targetLang - Target language code (e.g. 'uk').
 * @param srcLang    - Source language code (default 'en').
 */
export const listInnrGroups = async (
  db: Tx,
  modId: number,
  targetLang = CONFIG.defaultTgtLang,
  srcLang = CONFIG.defaultSrcLang,
): Promise<InnrResult> => {
  // Retrieve mod name for display
  const { rows: modRows } = await db.query<{ id: number; name: string }>(
    `SELECT id, name FROM mods WHERE id = $1`,
    [modId],
  );
  const mod = modRows[0];
  if (!mod) return { mod_id: modId, mod_name: '', total_rows: 0, groups: [] };

  const { rows } = await db.query<InnrRow>(
    `SELECT
      s.id                          AS string_id,
      r.formid_hex,
      r.edid,
      s.text_raw                    AS source,
      t.id                          AS translation_id,
      t.text                        AS translation,
      t.status,
      t.confidence,
      COALESCE(q.issue_count, 0)    AS qa_issue_count
     FROM strings s
     JOIN records r ON r.id = s.record_id
     LEFT JOIN translations t
       ON t.src_string_id = s.id AND t.target_lang = $2
          AND t.id = (
            SELECT id FROM translations
            WHERE src_string_id = s.id AND target_lang = $2
            ORDER BY ${BEST_TRANSLATION_ORDER}, COALESCE(confidence,0) DESC, created_at DESC
            LIMIT 1
          )
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS issue_count
       FROM qa_issues qi
       WHERE qi.src_string_id = s.id AND qi.target_lang = $2 AND qi.is_active = TRUE
     ) q ON TRUE
     WHERE r.mod_id = $1
       AND r.signature = 'INNR'
       AND s.lang = $3
     ORDER BY r.edid`,
    [modId, targetLang, srcLang],
  );

  // Group rows by base EDID prefix (strip trailing digit sequence)
  const groupMap = new Map<string, InnrRow[]>();
  for (const row of rows) {
    const baseEdid = (row.edid ?? '').replace(/\d+$/, '') || (row.edid ?? '');
    if (!groupMap.has(baseEdid)) groupMap.set(baseEdid, []);
    groupMap.get(baseEdid)!.push(row);
  }

  const groups: InnrGroup[] = [];
  for (const [base_edid, groupRows] of groupMap) {
    groups.push({ base_edid, rows: groupRows });
  }
  // Sort groups alphabetically by base EDID
  groups.sort((a, b) => a.base_edid.localeCompare(b.base_edid));

  return {
    mod_id: mod.id,
    mod_name: mod.name,
    total_rows: rows.length,
    groups,
  };
};

import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { getCachedModDetailStats } from '../../services/modLangStats';

// ── Stats ─────────────────────────────────────────────────────────────────────

/** Editor / API stats — served from {@link mod_lang_stats} (no live full-mod scan). */
export const getModStats = async (
  db: Tx,
  modId: number,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
) => getCachedModDetailStats(db, modId, srcLang, targetLang);

/**
 * Returns translation progress broken down by record signature (GRUP type) for the
 * specified mod. Each row represents one record type (e.g. DIAL, INFO, NPC_) with
 * per-status string counts — used by the Dashboard GRUP breakdown panel.
 *
 * @param db         - Database connection / transaction
 * @param modId      - ID of the mod to aggregate
 * @param targetLang - Target translation language (default 'uk')
 */
export const getModStatsByGrup = async (
  db: Tx,
  modId: number,
  targetLang = CONFIG.defaultTgtLang,
  srcLang = CONFIG.defaultSrcLang,
): Promise<
  Array<{
    signature: string;
    total: number;
    translated: number;
    approved: number;
    draft: number;
    tm: number;
    auto: number;
  }>
> => {
  const { rows } = await db.query(
    `SELECT
       r.signature,
       COUNT(DISTINCT s.id)::int                                                        AS total,
       COUNT(DISTINCT t.id)::int                                                        AS translated,
       COUNT(DISTINCT CASE WHEN t.status IN ('human','reviewed') THEN t.id END)::int   AS approved,
       COUNT(DISTINCT CASE WHEN t.status = 'draft'               THEN t.id END)::int   AS draft,
       COUNT(DISTINCT CASE WHEN t.status IN ('tm','fuzzy')        THEN t.id END)::int   AS tm,
       COUNT(DISTINCT CASE WHEN t.status IN ('auto','auto_translated') THEN t.id END)::int AS auto
     FROM records r
     JOIN strings s ON s.record_id = r.id AND s.lang = $3
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
     WHERE r.mod_id = $1
     GROUP BY r.signature
     ORDER BY total DESC, r.signature`,
    [modId, targetLang, srcLang],
  );
  return rows;
};

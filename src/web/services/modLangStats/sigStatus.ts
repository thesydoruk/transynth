import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';

/** Recompute per-signature counts by status (editor sidebar cache). */
export const refreshModSigStatusStats = async (
  db: Tx,
  modId: number,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
): Promise<void> => {
  await db.query(
    `DELETE FROM mod_sig_status_stats
     WHERE mod_id = $1 AND src_lang = $2 AND target_lang = $3`,
    [modId, srcLang, targetLang],
  );
  await db.query(
    `INSERT INTO mod_sig_status_stats (mod_id, src_lang, target_lang, status, signature, count, updated_at)
     SELECT
       $1,
       $3,
       $2,
       CASE
         WHEN s.is_ignored THEN 'skip'
         WHEN t.id IS NULL THEN 'untranslated'
         ELSE t.status
       END,
       r.signature,
       COUNT(*)::bigint,
       NOW()
     FROM records r
     JOIN strings s ON s.record_id = r.id AND s.lang = $3
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
     WHERE r.mod_id = $1
     GROUP BY 4, r.signature`,
    [modId, targetLang, srcLang],
  );
};

/** True when signature/status cache rows exist for this mod + language pair. */
export const hasModSigStatusCache = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<boolean> => {
  const { rows } = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM mod_sig_status_stats
       WHERE mod_id = $1 AND src_lang = $2 AND target_lang = $3
       LIMIT 1
     ) AS exists`,
    [modId, srcLang, targetLang],
  );
  return Boolean(rows[0]?.exists);
};

/** Fast sidebar counts for status-only filters (no column / text predicates). */
export const getCachedSignatureCounts = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
  statuses: string[],
): Promise<Array<{ signature: string; count: number }>> => {
  if (statuses.length === 0) {
    const { rows } = await db.query<{ signature: string; count: number }>(
      `SELECT signature, SUM(count)::int AS count
       FROM mod_sig_status_stats
       WHERE mod_id = $1 AND src_lang = $2 AND target_lang = $3
       GROUP BY signature
       HAVING SUM(count) > 0
       ORDER BY count DESC`,
      [modId, srcLang, targetLang],
    );
    return rows;
  }

  const { rows } = await db.query<{ signature: string; count: number }>(
    `SELECT signature, SUM(count)::int AS count
     FROM mod_sig_status_stats
     WHERE mod_id = $1 AND src_lang = $2 AND target_lang = $3 AND status = ANY($4::text[])
     GROUP BY signature
     HAVING SUM(count) > 0
     ORDER BY count DESC`,
    [modId, srcLang, targetLang, statuses],
  );
  return rows;
};

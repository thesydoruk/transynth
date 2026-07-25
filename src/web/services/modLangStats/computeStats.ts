import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { APPROVED_STATUS_SQL, type ModDetailStats } from './types';

/** Effective translation status for aggregation (matches editor filter semantics). */
export const EFFECTIVE_STATUS_SQL = `CASE
  WHEN s.is_ignored THEN 'skip'
  WHEN t.id IS NULL THEN 'untranslated'
  ELSE t.status
END`;

const modStringsJoin = `
  FROM records r
  JOIN strings s ON s.record_id = r.id AND s.lang = $3
  LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
  WHERE r.mod_id = $1`;

/** Per-mod translation breakdown — computed on read (no cache table). */
export const computeModDetailStats = async (
  db: Tx,
  modId: number,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
): Promise<ModDetailStats> => {
  const { rows } = await db.query<{
    string_count: string;
    translated_count: string;
    approved_count: string;
    draft_count: string;
    rejected_count: string;
    tm_count: string;
    fuzzy_count: string;
    auto_count: string;
    skipped_count: string;
    untranslated_count: string;
  }>(
    `SELECT
       COUNT(*)::bigint AS string_count,
       COUNT(t.id)::bigint AS translated_count,
       COUNT(*) FILTER (WHERE t.status IN ${APPROVED_STATUS_SQL})::bigint AS approved_count,
       COUNT(*) FILTER (WHERE t.status = 'draft')::bigint AS draft_count,
       COUNT(*) FILTER (WHERE t.status = 'rejected')::bigint AS rejected_count,
       COUNT(*) FILTER (WHERE t.status = 'tm')::bigint AS tm_count,
       COUNT(*) FILTER (WHERE t.status = 'fuzzy')::bigint AS fuzzy_count,
       COUNT(*) FILTER (WHERE t.status = 'auto')::bigint AS auto_count,
       COUNT(*) FILTER (WHERE s.is_ignored)::bigint AS skipped_count,
       COUNT(*) FILTER (WHERE t.id IS NULL AND NOT s.is_ignored)::bigint AS untranslated_count
     ${modStringsJoin}`,
    [modId, targetLang, srcLang],
  );
  const row = rows[0]!;
  return {
    total: Number(row.string_count) || 0,
    translated: Number(row.translated_count) || 0,
    approved: Number(row.approved_count) || 0,
    draft: Number(row.draft_count) || 0,
    rejected: Number(row.rejected_count) || 0,
    tm: Number(row.tm_count) || 0,
    fuzzy: Number(row.fuzzy_count) || 0,
    auto_translated: Number(row.auto_count) || 0,
    skipped: Number(row.skipped_count) || 0,
    untranslated: Number(row.untranslated_count) || 0,
  };
};

/** Fast total for status-only string filters (page-1 COUNT). */
export const computeStatusTotal = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
  statuses: string[],
): Promise<number> => {
  if (statuses.length === 0) return 0;

  const { rows } = await db.query<{ total: string }>(
    `SELECT COUNT(*)::bigint AS total
     ${modStringsJoin}
       AND (${EFFECTIVE_STATUS_SQL}) = ANY($4::text[])`,
    [modId, targetLang, srcLang, statuses],
  );
  return Number(rows[0]?.total) || 0;
};

/** Per-signature counts for status-only sidebar filters. */
export const computeSignatureCounts = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
  statuses: string[],
): Promise<Array<{ signature: string; count: number }>> => {
  if (statuses.length === 0) {
    const { rows } = await db.query<{ signature: string; count: number }>(
      `SELECT r.signature, COUNT(*)::int AS count
       ${modStringsJoin}
       GROUP BY r.signature
       HAVING COUNT(*) > 0
       ORDER BY count DESC`,
      [modId, targetLang, srcLang],
    );
    return rows;
  }

  const { rows } = await db.query<{ signature: string; count: number }>(
    `SELECT r.signature, COUNT(*)::int AS count
     ${modStringsJoin}
       AND (${EFFECTIVE_STATUS_SQL}) = ANY($4::text[])
     GROUP BY r.signature
     HAVING COUNT(*) > 0
     ORDER BY count DESC`,
    [modId, targetLang, srcLang, statuses],
  );
  return rows;
};

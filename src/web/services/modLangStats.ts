/**
 * Cached per-mod translation counts for {@link listMods} and editor stats
 * (avoids full-table aggregates on every page load).
 */
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import { log } from '../../logger';
import { mapWithConcurrency } from '../../utils/concurrency';

const APPROVED_STATUS_SQL = `('reviewed', 'human')`;

export type ModLangStatsRow = {
  mod_id: number;
  src_lang: string;
  target_lang: string;
  record_count: number;
  string_count: number;
  translated_count: number;
  approved_count: number;
  fuzzy_count: number;
  draft_count: number;
  rejected_count: number;
  tm_count: number;
  auto_count: number;
  skipped_count: number;
  untranslated_count: number;
  reviewed_count: number;
  human_count: number;
  updated_at: Date;
};

/** Shape returned by {@link getModStats} / GET /api/stats. */
export type ModDetailStats = {
  total: number;
  translated: number;
  approved: number;
  draft: number;
  rejected: number;
  tm: number;
  fuzzy: number;
  auto_translated: number;
  skipped: number;
  untranslated: number;
};

let columnsReady: Promise<void> | null = null;

/** Idempotent migration for detail-status columns used by the editor status bar. */
export const ensureModLangStatsColumns = async (db: Tx): Promise<void> => {
  if (!columnsReady) {
    columnsReady = db
      .query(
        `
        ALTER TABLE mod_lang_stats ADD COLUMN IF NOT EXISTS draft_count BIGINT NOT NULL DEFAULT 0;
        ALTER TABLE mod_lang_stats ADD COLUMN IF NOT EXISTS rejected_count BIGINT NOT NULL DEFAULT 0;
        ALTER TABLE mod_lang_stats ADD COLUMN IF NOT EXISTS tm_count BIGINT NOT NULL DEFAULT 0;
        ALTER TABLE mod_lang_stats ADD COLUMN IF NOT EXISTS auto_count BIGINT NOT NULL DEFAULT 0;
        ALTER TABLE mod_lang_stats ADD COLUMN IF NOT EXISTS skipped_count BIGINT NOT NULL DEFAULT 0;
        ALTER TABLE mod_lang_stats ADD COLUMN IF NOT EXISTS untranslated_count BIGINT NOT NULL DEFAULT 0;
        ALTER TABLE mod_lang_stats ADD COLUMN IF NOT EXISTS reviewed_count BIGINT NOT NULL DEFAULT 0;
        ALTER TABLE mod_lang_stats ADD COLUMN IF NOT EXISTS human_count BIGINT NOT NULL DEFAULT 0;
        CREATE TABLE IF NOT EXISTS mod_sig_status_stats (
          mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
          src_lang TEXT NOT NULL,
          target_lang TEXT NOT NULL,
          status TEXT NOT NULL,
          signature TEXT NOT NULL,
          count BIGINT NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (mod_id, src_lang, target_lang, status, signature)
        );
        CREATE INDEX IF NOT EXISTS idx_mod_sig_status_stats_lookup
          ON mod_sig_status_stats(mod_id, src_lang, target_lang, status);
        `,
      )
      .then(() => undefined)
      .catch((err) => {
        columnsReady = null;
        throw err;
      });
  }
  await columnsReady;
};

const toDetailStats = (row: ModLangStatsRow): ModDetailStats => ({
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
});

/** True when legacy cache rows have not been backfilled with per-status counts. */
const needsDetailBackfill = (row: ModLangStatsRow): boolean => {
  const translated = Number(row.translated_count) || 0;
  if (translated <= 0) return false;
  const detailSum =
    (Number(row.draft_count) || 0) +
    (Number(row.rejected_count) || 0) +
    (Number(row.tm_count) || 0) +
    (Number(row.auto_count) || 0) +
    (Number(row.approved_count) || 0) +
    (Number(row.fuzzy_count) || 0);
  // Before backfill, detail columns are 0 while translated_count is populated.
  return (
    detailSum === (Number(row.approved_count) || 0) + (Number(row.fuzzy_count) || 0) &&
    detailSum < translated
  );
};

const readCachedRow = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<ModLangStatsRow | null> => {
  const { rows } = await db.query<ModLangStatsRow>(
    `SELECT *
     FROM mod_lang_stats
     WHERE mod_id = $1 AND src_lang = $2 AND target_lang = $3`,
    [modId, srcLang, targetLang],
  );
  return rows[0] ?? null;
};

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

const STATUS_TOTAL_COLUMNS: Partial<Record<string, keyof ModLangStatsRow>> = {
  reviewed: 'reviewed_count',
  human: 'human_count',
  draft: 'draft_count',
  rejected: 'rejected_count',
  tm: 'tm_count',
  auto: 'auto_count',
  fuzzy: 'fuzzy_count',
  skip: 'skipped_count',
  untranslated: 'untranslated_count',
};

/** Fast total for status-only filters (page-1 COUNT cache). */
export const getCachedStatusTotal = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
  statuses: string[],
): Promise<number | null> => {
  if (statuses.length === 0) return null;

  const row = await readCachedRow(db, modId, srcLang, targetLang);
  if (!row) return null;

  if (statuses.length === 1) {
    const col = STATUS_TOTAL_COLUMNS[statuses[0]!];
    if (!col) return null;
    return Number(row[col]) || 0;
  }

  const allMapped = statuses.every((st) => STATUS_TOTAL_COLUMNS[st]);
  if (!allMapped) return null;

  return statuses.reduce((sum, st) => sum + (Number(row[STATUS_TOTAL_COLUMNS[st]!]) || 0), 0);
};

/** Recompute and upsert stats for one mod + language pair (indexed by mod_id — fast). */
export const refreshModLangStats = async (
  db: Tx,
  modId: number,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
): Promise<ModLangStatsRow> => {
  // Drive from records(mod_id); FILTER instead of COUNT(DISTINCT) — unique keys guarantee 1:1.
  const { rows } = await db.query<ModLangStatsRow>(
    `INSERT INTO mod_lang_stats (
       mod_id, src_lang, target_lang,
       record_count, string_count, translated_count, approved_count, fuzzy_count,
       draft_count, rejected_count, tm_count, auto_count, skipped_count, untranslated_count,
       reviewed_count, human_count,
       updated_at
     )
     SELECT
       $1,
       $3,
       $2,
       (SELECT COUNT(*)::bigint FROM records WHERE mod_id = $1),
       COUNT(*)::bigint,
       COUNT(t.id)::bigint,
       COUNT(*) FILTER (WHERE t.status IN ${APPROVED_STATUS_SQL})::bigint,
       COUNT(*) FILTER (WHERE t.status = 'fuzzy')::bigint,
       COUNT(*) FILTER (WHERE t.status = 'draft')::bigint,
       COUNT(*) FILTER (WHERE t.status = 'rejected')::bigint,
       COUNT(*) FILTER (WHERE t.status = 'tm')::bigint,
       COUNT(*) FILTER (WHERE t.status = 'auto')::bigint,
       COUNT(*) FILTER (WHERE s.is_ignored)::bigint,
       COUNT(*) FILTER (WHERE t.id IS NULL AND NOT s.is_ignored)::bigint,
       COUNT(*) FILTER (WHERE t.status = 'reviewed')::bigint,
       COUNT(*) FILTER (WHERE t.status = 'human')::bigint,
       NOW()
     FROM records r
     JOIN strings s ON s.record_id = r.id AND s.lang = $3
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
     WHERE r.mod_id = $1
     ON CONFLICT (mod_id, src_lang, target_lang) DO UPDATE SET
       record_count = EXCLUDED.record_count,
       string_count = EXCLUDED.string_count,
       translated_count = EXCLUDED.translated_count,
       approved_count = EXCLUDED.approved_count,
       fuzzy_count = EXCLUDED.fuzzy_count,
       draft_count = EXCLUDED.draft_count,
       rejected_count = EXCLUDED.rejected_count,
       tm_count = EXCLUDED.tm_count,
       auto_count = EXCLUDED.auto_count,
       skipped_count = EXCLUDED.skipped_count,
       untranslated_count = EXCLUDED.untranslated_count,
       reviewed_count = EXCLUDED.reviewed_count,
       human_count = EXCLUDED.human_count,
       updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [modId, targetLang, srcLang],
  );
  await refreshModSigStatusStats(db, modId, srcLang, targetLang);
  return rows[0]!;
};

/**
 * Fast editor/list stats: PK lookup on {@link mod_lang_stats}.
 * Sync-refreshes only on complete cache miss. Legacy rows (pre-detail columns)
 * approximate TM locally — no full-mod rescan on the request path.
 */
export const getCachedModDetailStats = async (
  db: Tx,
  modId: number,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
): Promise<ModDetailStats> => {
  let row = await readCachedRow(db, modId, srcLang, targetLang);
  if (!row) {
    row = await refreshModLangStats(db, modId, srcLang, targetLang);
    return toDetailStats(row);
  }

  const stats = toDetailStats(row);
  if (needsDetailBackfill(row)) {
    if (stats.tm === 0 && stats.draft === 0 && stats.auto_translated === 0) {
      stats.tm = Math.max(0, stats.translated - stats.approved - stats.fuzzy);
    }
  }

  return stats;
};

/** Refresh stats for several mods (e.g. after bulk job or cache miss on list). */
export const refreshModLangStatsForMods = async (
  db: Tx,
  modIds: number[],
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
  workers = 4,
): Promise<void> => {
  const unique = [...new Set(modIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) return;

  await mapWithConcurrency(unique, workers, async (modId) => {
    await refreshModLangStats(db, modId, srcLang, targetLang);
  });
};

/** In-flight background refreshes — one per mod/lang pair (avoids stampedes on editor load). */
const refreshInFlight = new Map<string, Promise<void>>();

/** Best-effort refresh — never throws (safe after background jobs). */
export const tryRefreshModLangStats = (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): void => {
  const key = `${modId}:${srcLang}:${targetLang}`;
  if (refreshInFlight.has(key)) return;

  const run = refreshModLangStats(db, modId, srcLang, targetLang)
    .then(() => undefined)
    .catch((err) => {
      log.warn('mod_lang_stats refresh failed', {
        modId,
        srcLang,
        targetLang,
        error: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => {
      refreshInFlight.delete(key);
    });

  refreshInFlight.set(key, run);
};

/** Backfill cache for every mod (optionally one game). */
export const refreshAllModLangStats = async (
  db: Tx,
  opts: { srcLang?: string; targetLang?: string; game?: string } = {},
): Promise<number> => {
  const srcLang = opts.srcLang ?? CONFIG.defaultSrcLang;
  const targetLang = opts.targetLang ?? CONFIG.defaultTgtLang;

  const { rows } = await db.query<{ id: number }>(
    opts.game
      ? `SELECT id FROM mods WHERE game = $1 ORDER BY id`
      : `SELECT id FROM mods ORDER BY id`,
    opts.game ? [opts.game] : [],
  );

  await refreshModLangStatsForMods(
    db,
    rows.map((r) => r.id),
    srcLang,
    targetLang,
  );
  return rows.length;
};

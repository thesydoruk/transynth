/**
 * Cached per-mod translation counts for {@link listMods} (avoids full-table aggregates).
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
  updated_at: Date;
};

/** Recompute and upsert stats for one mod + language pair (indexed by mod_id — fast). */
export const refreshModLangStats = async (
  db: Tx,
  modId: number,
  srcLang = CONFIG.defaultSrcLang,
  targetLang = CONFIG.defaultTgtLang,
): Promise<ModLangStatsRow> => {
  const { rows } = await db.query<ModLangStatsRow>(
    `INSERT INTO mod_lang_stats (
       mod_id, src_lang, target_lang,
       record_count, string_count, translated_count, approved_count, fuzzy_count, updated_at
     )
     SELECT
       $1,
       $3,
       $2,
       (SELECT COUNT(*)::bigint FROM records WHERE mod_id = $1),
       COUNT(DISTINCT s.id)::bigint,
       COUNT(DISTINCT t.id)::bigint,
       COUNT(DISTINCT CASE WHEN t.status IN ${APPROVED_STATUS_SQL} THEN t.id END)::bigint,
       COUNT(DISTINCT CASE WHEN t.status = 'fuzzy' THEN t.id END)::bigint,
       NOW()
     FROM strings s
     JOIN records r ON s.record_id = r.id
     LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
     WHERE r.mod_id = $1 AND s.lang = $3
     ON CONFLICT (mod_id, src_lang, target_lang) DO UPDATE SET
       record_count = EXCLUDED.record_count,
       string_count = EXCLUDED.string_count,
       translated_count = EXCLUDED.translated_count,
       approved_count = EXCLUDED.approved_count,
       fuzzy_count = EXCLUDED.fuzzy_count,
       updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [modId, targetLang, srcLang],
  );
  return rows[0]!;
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

/** Best-effort refresh — never throws (safe after background jobs). */
export const tryRefreshModLangStats = (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): void => {
  void refreshModLangStats(db, modId, srcLang, targetLang).catch((err) => {
    log.warn('mod_lang_stats refresh failed', {
      modId,
      srcLang,
      targetLang,
      error: err instanceof Error ? err.message : String(err),
    });
  });
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

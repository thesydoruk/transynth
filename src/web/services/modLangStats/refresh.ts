import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { log } from '../../../logger';
import { mapWithConcurrency } from '../../../utils/concurrency';
import { APPROVED_STATUS_SQL, type ModLangStatsRow } from './types';
import { refreshModSigStatusStats } from './sigStatus';

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

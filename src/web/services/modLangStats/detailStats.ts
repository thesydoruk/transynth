import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { needsDetailBackfill, readCachedRow, toDetailStats } from './cacheRead';
import { refreshModLangStats } from './refresh';
import type { ModDetailStats } from './types';

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

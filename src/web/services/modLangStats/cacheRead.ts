import type { Tx } from '../../../db';
import type { ModDetailStats, ModLangStatsRow } from './types';

export const toDetailStats = (row: ModLangStatsRow): ModDetailStats => ({
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
export const needsDetailBackfill = (row: ModLangStatsRow): boolean => {
  const translated = Number(row.translated_count) || 0;
  if (translated <= 0) return false;
  const detailSum =
    (Number(row.draft_count) || 0) +
    (Number(row.rejected_count) || 0) +
    (Number(row.tm_count) || 0) +
    (Number(row.auto_count) || 0) +
    (Number(row.approved_count) || 0) +
    (Number(row.fuzzy_count) || 0);
  return (
    detailSum === (Number(row.approved_count) || 0) + (Number(row.fuzzy_count) || 0) &&
    detailSum < translated
  );
};

export const readCachedRow = async (
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

export const STATUS_TOTAL_COLUMNS: Partial<Record<string, keyof ModLangStatsRow>> = {
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

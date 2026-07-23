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

export const APPROVED_STATUS_SQL = `('reviewed', 'human')`;

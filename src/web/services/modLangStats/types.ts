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

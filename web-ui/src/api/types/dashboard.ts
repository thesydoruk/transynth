export type DashboardModRow = {
  id: number;
  name: string;
  game: string;
  total: number;
  translated: number;
  approved: number;
  draft: number;
  tm: number;
  fuzzy: number;
  auto: number;
  rejected: number;
  reviewed: number;
  qa_issues: number;
};

export type DashboardData = {
  mods: DashboardModRow[];
  qaByType: { issue_type: string; count: number }[];
  qaBySeverity: { severity: string; count: number }[];
  /** Mod IDs that currently have an active job (used for live badges in the dashboard table). */
  activeJobs: { llmModIds: number[]; importModIds: number[] };
};

/** One row from GET /api/stats/grup — translation progress for a single GRUP signature. */
export type GrupStatRow = {
  signature: string;
  total: number;
  translated: number;
  approved: number;
  draft: number;
  tm: number;
  auto: number;
};

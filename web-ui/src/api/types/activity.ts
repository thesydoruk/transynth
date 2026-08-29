/** A single activity log entry returned by /api/activity. */
export type ActivityEntry = {
  id: number;
  user_id: number | null;
  display_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

/** Paginated response from /api/activity. */
export type ActivityLogResponse = {
  entries: ActivityEntry[];
  total: number;
  limit: number;
  offset: number;
};

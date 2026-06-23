/**
 * Activity log service — records actions for auditability.
 *
 * All activity is attributed to the built-in default user (id=1).
 * The log is append-only and never modified or deleted (audit trail).
 */

import type pg from 'pg';

/** A single entry in the activity log. */
export interface ActivityEntry {
  id: number;
  user_id: number | null;
  display_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Records an action in the activity log.
 *
 * @param db       - Database pool or client.
 * @param userId   - The user who performed the action (null if unknown).
 * @param action   - Short action verb: translate, import, export, etc.
 * @param entityType - The type of entity affected (mod, string, translation, glossary, user).
 * @param entityId - The primary key of the affected entity.
 * @param details  - Optional JSON object with additional context.
 */
export const logActivity = async (
  db: pg.Pool | pg.PoolClient,
  userId: number | null,
  action: string,
  entityType?: string | null,
  entityId?: number | null,
  details?: Record<string, unknown> | null,
): Promise<void> => {
  await db.query(
    `INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      userId,
      action,
      entityType ?? null,
      entityId ?? null,
      details ? JSON.stringify(details) : null,
    ],
  );
};

/**
 * Retrieves recent activity log entries with user info joined.
 *
 * @param db          - Database pool.
 * @param limit       - Maximum number of entries to return (default 100).
 * @param offset      - Offset for pagination (default 0).
 * @param userId      - Optional filter: only entries by this user.
 * @param action      - Optional filter: only entries with this action type.
 * @param entityType  - Optional filter: only entries affecting this entity type.
 * @param entityId    - Optional filter: only entries affecting this entity ID.
 * @param dateFrom    - Optional ISO-8601 date string: only entries on or after this date.
 * @param dateTo      - Optional ISO-8601 date string: only entries on or before this date.
 * @returns Array of activity entries, most recent first.
 */
export const getActivityLog = async (
  db: pg.Pool,
  limit = 100,
  offset = 0,
  userId?: number,
  action?: string,
  entityType?: string,
  entityId?: number,
  dateFrom?: string,
  dateTo?: string,
): Promise<ActivityEntry[]> => {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (userId !== undefined) {
    conditions.push(`a.user_id = $${idx++}`);
    params.push(userId);
  }
  if (action !== undefined) {
    conditions.push(`a.action = $${idx++}`);
    params.push(action);
  }
  if (entityType !== undefined) {
    conditions.push(`a.entity_type = $${idx++}`);
    params.push(entityType);
  }
  if (entityId !== undefined) {
    conditions.push(`a.entity_id = $${idx++}`);
    params.push(entityId);
  }
  if (dateFrom !== undefined) {
    conditions.push(`a.created_at >= $${idx++}`);
    params.push(dateFrom);
  }
  if (dateTo !== undefined) {
    // Include the entire "to" day by extending to end-of-day
    conditions.push(`a.created_at < ($${idx++}::date + INTERVAL '1 day')`);
    params.push(dateTo);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const { rows } = await db.query<ActivityEntry>(
    `SELECT a.id, a.user_id, u.display_name,
            a.action, a.entity_type, a.entity_id, a.details, a.created_at
     FROM activity_log a
     LEFT JOIN users u ON a.user_id = u.id
     ${where}
     ORDER BY a.created_at DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    params,
  );
  return rows;
};

/**
 * Returns the total count of activity log entries (for pagination).
 */
export const getActivityCount = async (
  db: pg.Pool,
  userId?: number,
  action?: string,
  entityType?: string,
  entityId?: number,
  dateFrom?: string,
  dateTo?: string,
): Promise<number> => {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (userId !== undefined) {
    conditions.push(`user_id = $${params.length + 1}`);
    params.push(userId);
  }
  if (action !== undefined) {
    conditions.push(`action = $${params.length + 1}`);
    params.push(action);
  }
  if (entityType !== undefined) {
    conditions.push(`entity_type = $${params.length + 1}`);
    params.push(entityType);
  }
  if (entityId !== undefined) {
    conditions.push(`entity_id = $${params.length + 1}`);
    params.push(entityId);
  }
  if (dateFrom !== undefined) {
    conditions.push(`created_at >= $${params.length + 1}`);
    params.push(dateFrom);
  }
  if (dateTo !== undefined) {
    conditions.push(`created_at < ($${params.length + 1}::date + INTERVAL '1 day')`);
    params.push(dateTo);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query(`SELECT COUNT(*)::int AS cnt FROM activity_log ${where}`, params);
  return rows[0].cnt;
};

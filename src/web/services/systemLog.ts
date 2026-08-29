/**
 * Operational system log — health-wait failures, job errors, recoveries.
 * Append-only; UI reads via GET /api/system-log.
 */
import type { Tx } from '../../db';
import { log } from '../../logger';

export const SYSTEM_LOG_LEVELS = ['error', 'warning', 'info'] as const;
export const SYSTEM_LOG_SOURCES = ['llm', 'tts', 'job', 'system'] as const;

export type SystemLogLevel = (typeof SYSTEM_LOG_LEVELS)[number];
export type SystemLogSource = (typeof SYSTEM_LOG_SOURCES)[number];

export type SystemLogEntry = {
  id: number;
  level: SystemLogLevel;
  source: SystemLogSource;
  message: string;
  job_id: number | null;
  job_kind: string | null;
  mod_id: number | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

export type NewSystemLog = {
  level: SystemLogLevel;
  source: SystemLogSource;
  message: string;
  jobId?: number | null;
  jobKind?: string | null;
  modId?: number | null;
  details?: Record<string, unknown> | null;
};

const isLevel = (value: string | undefined): value is SystemLogLevel =>
  value != null && (SYSTEM_LOG_LEVELS as readonly string[]).includes(value);

const isSource = (value: string | undefined): value is SystemLogSource =>
  value != null && (SYSTEM_LOG_SOURCES as readonly string[]).includes(value);

/** Persist one system event. Failures are logged and never thrown. */
export const writeSystemLog = async (db: Tx, entry: NewSystemLog): Promise<void> => {
  try {
    await db.query(
      `INSERT INTO system_log (level, source, message, job_id, job_kind, mod_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        entry.level,
        entry.source,
        entry.message,
        entry.jobId ?? null,
        entry.jobKind ?? null,
        entry.modId ?? null,
        entry.details ? JSON.stringify(entry.details) : null,
      ],
    );
  } catch (err) {
    log.warn(`system_log write failed: ${err instanceof Error ? err.message : String(err)}`);
  }
};

export type SystemLogFilters = {
  level?: string;
  source?: string;
  limit?: number;
  offset?: number;
};

const buildWhere = (
  filters: Pick<SystemLogFilters, 'level' | 'source'>,
): { where: string; params: unknown[] } => {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (isLevel(filters.level)) {
    params.push(filters.level);
    conditions.push(`level = $${params.length}`);
  }
  if (isSource(filters.source)) {
    params.push(filters.source);
    conditions.push(`source = $${params.length}`);
  }
  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
};

/** Newest-first page of system log rows. */
export const listSystemLog = async (
  db: Tx,
  filters: SystemLogFilters = {},
): Promise<SystemLogEntry[]> => {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);
  const { where, params } = buildWhere(filters);
  const { rows } = await db.query<SystemLogEntry>(
    `SELECT id, level, source, message, job_id, job_kind, mod_id, details, created_at
     FROM system_log
     ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  return rows;
};

export const countSystemLog = async (
  db: Tx,
  filters: Pick<SystemLogFilters, 'level' | 'source'> = {},
): Promise<number> => {
  const { where, params } = buildWhere(filters);
  const { rows } = await db.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM system_log ${where}`,
    params,
  );
  return rows[0]?.cnt ?? 0;
};

/**
 * Activity log API routes — query the audit trail.
 *
 * Endpoints:
 * - GET /api/activity     — returns paginated activity log entries with optional filters.
 * - GET /api/activity/csv — returns the same entries as a CSV download (max 10 000 rows).
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import type pg from 'pg';
import { getActivityLog, getActivityCount } from '../activityService';

/** Shared filter params extracted from a request query string. */
interface ActivityQuerystring {
  limit?: string;
  offset?: string;
  userId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Parses and validates the common filter params from a query string. */
const parseFilters = (q: ActivityQuerystring) => {
  return {
    userId: q.userId ? parseInt(q.userId, 10) : undefined,
    action: q.action || undefined,
    entityType: q.entityType || undefined,
    entityId: q.entityId ? parseInt(q.entityId, 10) : undefined,
    dateFrom: q.dateFrom || undefined,
    dateTo: q.dateTo || undefined,
  };
};

/** Escapes a CSV cell value (wraps in quotes if it contains comma, quote, or newline). */
const csvCell = (value: unknown): string => {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

/**
 * Registers activity log routes on the Fastify instance.
 *
 * @param app - Fastify application instance.
 * @param db  - PostgreSQL connection pool.
 */
export const activityRoutes = async (app: FastifyInstance, db: pg.Pool): Promise<void> => {
  /**
   * GET /api/activity
   * Returns paginated activity log entries.
   *
   * Query params:
   * - limit       (number, default 100, max 500) — items per page
   * - offset      (number, default 0)            — pagination offset
   * - userId      (number, optional)             — filter by user
   * - action      (string, optional)             — filter by action type
   * - entityType  (string, optional)             — filter by entity type (e.g. "mod")
   * - entityId    (number, optional)             — filter by entity ID
   * - dateFrom    (string, optional)             — ISO date lower bound (inclusive)
   * - dateTo      (string, optional)             — ISO date upper bound (inclusive, end-of-day)
   */
  app.get<{ Querystring: ActivityQuerystring }>('/api/activity', async (req) => {
    const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
    const offset = parseInt(req.query.offset || '0', 10) || 0;
    const { userId, action, entityType, entityId, dateFrom, dateTo } = parseFilters(req.query);

    const [entries, total] = await Promise.all([
      getActivityLog(db, limit, offset, userId, action, entityType, entityId, dateFrom, dateTo),
      getActivityCount(db, userId, action, entityType, entityId, dateFrom, dateTo),
    ]);

    return { entries, total, limit, offset };
  });

  /**
   * GET /api/activity/csv
   * Downloads the filtered activity log as a CSV file (max 10 000 rows, no pagination).
   *
   * Accepts the same filter query params as GET /api/activity (except limit/offset).
   */
  app.get<{ Querystring: ActivityQuerystring }>(
    '/api/activity/csv',
    async (req, reply: FastifyReply) => {
      const { userId, action, entityType, entityId, dateFrom, dateTo } = parseFilters(req.query);

      const entries = await getActivityLog(
        db,
        10000,
        0,
        userId,
        action,
        entityType,
        entityId,
        dateFrom,
        dateTo,
      );

      const header = [
        'id',
        'created_at',
        'user',
        'action',
        'entity_type',
        'entity_id',
        'details',
      ].join(',');
      const rows = entries.map((e) =>
        [
          e.id,
          e.created_at,
          e.display_name ?? '',
          e.action,
          e.entity_type ?? '',
          e.entity_id ?? '',
          e.details ? JSON.stringify(e.details) : '',
        ]
          .map(csvCell)
          .join(','),
      );

      const csv = [header, ...rows].join('\r\n');

      void reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="activity.csv"')
        .send(csv);
    },
  );
};

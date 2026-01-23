/**
 * Activity log API routes — query the audit trail.
 *
 * Endpoints:
 * - GET /api/activity — returns paginated activity log entries with optional filters.
 */

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { getActivityLog, getActivityCount } from '../activityService.js';

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
   * - limit   (number, default 100, max 500) — items per page
   * - offset  (number, default 0) — pagination offset
   * - userId  (number, optional) — filter by user
   * - action  (string, optional) — filter by action type
   */
  app.get<{
    Querystring: { limit?: string; offset?: string; userId?: string; action?: string };
  }>('/api/activity', async (req) => {
    const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
    const offset = parseInt(req.query.offset || '0', 10) || 0;
    const userId = req.query.userId ? parseInt(req.query.userId, 10) : undefined;
    const action = req.query.action || undefined;

    const [entries, total] = await Promise.all([
      getActivityLog(db, limit, offset, userId, action),
      getActivityCount(db, userId, action),
    ]);

    return { entries, total, limit, offset };
  });
};

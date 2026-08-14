/**
 * System log API — operational errors and health-wait messages.
 *
 *   GET /api/system-log — paginated entries, newest first.
 */
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { countSystemLog, listSystemLog } from '../services/systemLog';

type SystemLogQuery = {
  limit?: string;
  offset?: string;
  level?: string;
  source?: string;
};

export const systemLogRoutes = async (app: FastifyInstance, db: Tx): Promise<void> => {
  app.get<{ Querystring: SystemLogQuery }>('/api/system-log', async (req) => {
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 500);
    const offset = parseInt(req.query.offset || '0', 10) || 0;
    const level = req.query.level || undefined;
    const source = req.query.source || undefined;
    const [entries, total] = await Promise.all([
      listSystemLog(db, { limit, offset, level, source }),
      countSystemLog(db, { level, source }),
    ]);
    return { entries, total, limit, offset };
  });
};

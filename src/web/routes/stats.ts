import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db.js';
import { log } from '../../logger.js';
import { getModStats, getModStatsByGrup } from '../queries.js';

export const statsRoutes = async (app: FastifyInstance, db: Tx) => {
  // GET /api/stats?modId=  — translation progress breakdown for one mod
  app.get<{ Querystring: { modId?: string } }>('/api/stats', async (req, reply) => {
    const modId = Number(req.query.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }

    const row = await getModStats(db, modId) as Record<string, number>;

    const pct = row.total > 0 ? Math.round((row.translated / row.total) * 100) : 0;
    log.trace(`GET /api/stats modId=${modId} total=${row.total} translated=${row.translated} pct=${pct}%`);
    return reply.send({ ...row, percent: pct });
  });

  // GET /api/stats/global  — aggregated stats across all mods
  app.get('/api/stats/global', async (_req, reply) => {
    const { rows } = await db.query(
      `SELECT
          m.id, m.name,
          COUNT(DISTINCT s.id)                                      AS total,
          COUNT(DISTINCT t.id)                                      AS translated,
          COUNT(DISTINCT CASE WHEN t.status='human' THEN t.id END)  AS approved
         FROM mods m
         LEFT JOIN records r ON r.mod_id = m.id
         LEFT JOIN strings s ON s.record_id = r.id AND s.lang = 'en'
         LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = 'uk'
         GROUP BY m.id
         ORDER BY m.name`,
    );

    return reply.send(rows);
  });

  // GET /api/stats/dashboard  — full dashboard data (progress + QA breakdown)
  app.get('/api/stats/dashboard', async (_req, reply) => {
    const [modProgress, qaBreakdown, qaBySeverity] = await Promise.all([
      db.query(
        `SELECT
           m.id, m.name,
           COUNT(DISTINCT s.id)                                           AS total,
           COUNT(DISTINCT t.id)                                           AS translated,
           COUNT(DISTINCT CASE WHEN t.status = 'human' THEN t.id END)    AS approved,
           COUNT(DISTINCT CASE WHEN t.status = 'draft' THEN t.id END)    AS draft,
           COUNT(DISTINCT CASE WHEN t.status = 'tm' THEN t.id END)       AS tm,
           COUNT(DISTINCT CASE WHEN t.status = 'fuzzy' THEN t.id END)    AS fuzzy,
           COUNT(DISTINCT CASE WHEN t.status IN ('auto','auto_translated') THEN t.id END) AS auto,
           COUNT(DISTINCT CASE WHEN t.status = 'rejected' THEN t.id END) AS rejected,
           COUNT(DISTINCT CASE WHEN t.status = 'reviewed' THEN t.id END) AS reviewed,
           COUNT(DISTINCT q.id)                                           AS qa_issues
         FROM mods m
         LEFT JOIN records r ON r.mod_id = m.id
         LEFT JOIN strings s ON s.record_id = r.id AND s.lang = 'en'
         LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = 'uk'
         LEFT JOIN qa_issues q ON q.src_string_id = s.id AND q.target_lang = 'uk' AND q.is_active = TRUE
         GROUP BY m.id
         ORDER BY m.name`,
      ),
      db.query(
        `SELECT issue_type, COUNT(*) AS count
         FROM qa_issues WHERE is_active = TRUE
         GROUP BY issue_type ORDER BY count DESC`,
      ),
      db.query(
        `SELECT severity, COUNT(*) AS count
         FROM qa_issues WHERE is_active = TRUE
         GROUP BY severity ORDER BY severity`,
      ),
    ]);

    return reply.send({
      mods: modProgress.rows,
      qaByType: qaBreakdown.rows,
      qaBySeverity: qaBySeverity.rows,
    });
  });

  // GET /api/stats/grup?modId=X&lang=uk
  // Returns translation progress broken down by record signature (GRUP type) for one mod.
  app.get<{ Querystring: { modId?: string; lang?: string } }>('/api/stats/grup', async (req, reply) => {
    const modId = Number(req.query.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }
    const lang = req.query.lang ?? 'uk';
    const rows = await getModStatsByGrup(db, modId, lang);
    return reply.send(rows);
  });
}

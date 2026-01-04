import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db.js';

export async function statsRoutes(app: FastifyInstance, db: Tx) {
  // GET /api/stats?modId=  — translation progress breakdown for one mod
  app.get<{ Querystring: { modId?: string } }>('/api/stats', async (req, reply) => {
    const modId = Number(req.query.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'modId is required' });
    }

    const row = db
      .prepare(
        `SELECT
          COUNT(DISTINCT s.id)                                      AS total,
          COUNT(DISTINCT t.id)                                      AS translated,
          COUNT(DISTINCT CASE WHEN t.status='human' THEN t.id END)  AS approved,
          COUNT(DISTINCT CASE WHEN t.status='tm'    THEN t.id END)  AS tm,
          COUNT(DISTINCT CASE WHEN t.status='fuzzy' THEN t.id END)  AS fuzzy,
          COUNT(DISTINCT CASE WHEN t.status='auto'  THEN t.id END)  AS auto_translated,
          COUNT(DISTINCT CASE WHEN t.id IS NULL      THEN s.id END) AS untranslated
         FROM strings s
         JOIN records r ON s.record_id = r.id
         LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = 'uk'
         WHERE r.mod_id = ? AND s.lang = 'en'`,
      )
      .get(modId) as Record<string, number>;

    const pct = row.total > 0 ? Math.round((row.translated / row.total) * 100) : 0;
    return reply.send({ ...row, percent: pct });
  });

  // GET /api/stats/global  — aggregated stats across all mods
  app.get('/api/stats/global', async (_req, reply) => {
    const rows = db
      .prepare(
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
      )
      .all();

    return reply.send(rows);
  });
}

import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { log } from '../../logger';
import { CONFIG } from '../../config';
import { getModStats, getModStatsByGrup } from '../data/queries';

export const statsRoutes = async (app: FastifyInstance, db: Tx) => {
  // GET /api/stats?modId=&srcLang=&targetLang=  — translation progress breakdown for one mod
  app.get<{ Querystring: { modId?: string; srcLang?: string; targetLang?: string } }>(
    '/api/stats',
    async (req, reply) => {
      const modId = Number(req.query.modId);
      if (!Number.isInteger(modId) || modId < 1) {
        return reply.code(400).send({ error: 'modId is required' });
      }
      const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;

      const row = (await getModStats(db, modId, srcLang, targetLang)) as Record<string, number>;

      const pct = row.total > 0 ? Math.round((row.translated / row.total) * 100) : 0;
      log.trace(
        `GET /api/stats modId=${modId} total=${row.total} translated=${row.translated} pct=${pct}%`,
      );
      return reply.send({ ...row, percent: pct });
    },
  );

  // GET /api/stats/global?srcLang=&targetLang=  — aggregated stats across all mods
  app.get<{ Querystring: { srcLang?: string; targetLang?: string } }>(
    '/api/stats/global',
    async (req, reply) => {
      const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      const { rows } = await db.query(
        `SELECT
          m.id, m.name,
          COUNT(DISTINCT s.id)                                      AS total,
          COUNT(DISTINCT t.id)                                      AS translated,
          COUNT(DISTINCT CASE WHEN t.status='human' THEN t.id END)  AS approved
         FROM mods m
         LEFT JOIN records r ON r.mod_id = m.id
         LEFT JOIN strings s ON s.record_id = r.id AND s.lang = $1
         LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
         GROUP BY m.id
         ORDER BY m.name`,
        [srcLang, targetLang],
      );

      return reply.send(rows);
    },
  );

  // GET /api/stats/dashboard?srcLang=&targetLang=  — full dashboard data (progress + QA breakdown)
  app.get<{ Querystring: { srcLang?: string; targetLang?: string } }>(
    '/api/stats/dashboard',
    async (req, reply) => {
      const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      const [modProgress, qaBreakdown, qaBySeverity, llmActiveResult, importActiveResult] =
        await Promise.all([
          db.query(
            `SELECT
           m.id, m.name, m.game,
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
         LEFT JOIN strings s ON s.record_id = r.id AND s.lang = $1
         LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
         LEFT JOIN qa_issues q ON q.src_string_id = s.id AND q.target_lang = $2 AND q.is_active = TRUE
         GROUP BY m.id
         ORDER BY m.name`,
            [srcLang, targetLang],
          ),
          db.query(
            `SELECT issue_type, COUNT(*) AS count
         FROM qa_issues WHERE is_active = TRUE AND target_lang = $1
         GROUP BY issue_type ORDER BY count DESC`,
            [targetLang],
          ),
          db.query(
            `SELECT severity, COUNT(*) AS count
         FROM qa_issues WHERE is_active = TRUE AND target_lang = $1
         GROUP BY severity ORDER BY severity`,
            [targetLang],
          ),
          // Mods with a currently running LLM batch job.
          db.query(
            `SELECT DISTINCT mod_id FROM llm_jobs WHERE status = 'running' AND mod_id IS NOT NULL`,
          ),
          // Mods with an active import job (mod archive — eet/csv have no mod_id).
          db.query(
            `SELECT DISTINCT mod_id FROM mod_imports WHERE status IN ('pending','extracting','in_progress') AND mod_id IS NOT NULL`,
          ),
        ]);

      return reply.send({
        mods: modProgress.rows,
        qaByType: qaBreakdown.rows,
        qaBySeverity: qaBySeverity.rows,
        activeJobs: {
          llmModIds: (llmActiveResult.rows as Array<{ mod_id: number }>).map((r) =>
            Number(r.mod_id),
          ),
          importModIds: (importActiveResult.rows as Array<{ mod_id: number }>).map((r) =>
            Number(r.mod_id),
          ),
        },
      });
    },
  );

  // GET /api/stats/grup?modId=X&lang=uk&srcLang=en
  // Returns translation progress broken down by record signature (GRUP type) for one mod.
  app.get<{ Querystring: { modId?: string; lang?: string; srcLang?: string } }>(
    '/api/stats/grup',
    async (req, reply) => {
      const modId = Number(req.query.modId);
      if (!Number.isInteger(modId) || modId < 1) {
        return reply.code(400).send({ error: 'modId is required' });
      }
      const lang = req.query.lang ?? CONFIG.defaultTgtLang;
      const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
      const rows = await getModStatsByGrup(db, modId, lang, srcLang);
      return reply.send(rows);
    },
  );
};

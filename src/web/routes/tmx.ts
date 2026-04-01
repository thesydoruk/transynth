/**
 * TMX (Translation Memory eXchange) routes.
 *
 * Provides endpoints for exporting and importing TMX files, enabling
 * interoperability with external translation tools like SDL Trados,
 * memoQ, OmegaT, and others that support the TMX 1.4b standard.
 */

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { log } from '../../logger';
import { exportTmx, importTmx } from '../tmxService';
import { CONFIG } from '../../config';

/**
 * Register TMX import/export routes on the Fastify app.
 *
 * @param app  Fastify instance to attach routes to
 * @param db   PostgreSQL pool used for all DB operations
 */
export const tmxRoutes = async (app: FastifyInstance, db: pg.Pool) => {
  /**
   * GET /api/tmx/export?srcLang=en&targetLang=uk&modId=123
   *
   * Export translations as a downloadable TMX 1.4b XML file.
   * If modId is provided, only that mod's translations are exported;
   * otherwise all translations in the DB are included.
   */
  app.get<{ Querystring: { srcLang?: string; targetLang?: string; modId?: string } }>(
    '/api/tmx/export',
    async (req, reply) => {
      const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      const modId = req.query.modId ? Number(req.query.modId) : undefined;

      if (modId != null && (!Number.isInteger(modId) || modId < 1)) {
        return reply.code(400).send({ error: 'Invalid modId' });
      }

      log.info(`GET /api/tmx/export srcLang=${srcLang} targetLang=${targetLang} modId=${modId ?? 'all'}`);

      const xml = await exportTmx(db, srcLang, targetLang, modId);

      const filename = modId != null
        ? `tm_mod${modId}_${srcLang}_${targetLang}.tmx`
        : `tm_all_${srcLang}_${targetLang}.tmx`;

      return reply
        .header('Content-Type', 'application/xml; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(xml);
    },
  );

  /**
   * POST /api/tmx/import?modId=123
   *
   * Import a TMX file uploaded as multipart form data.
   * The file field must be named "file".
   * If modId is provided, imported translations are matched only against
   * strings belonging to that mod; otherwise they are matched globally.
   */
  app.post<{ Querystring: { modId?: string } }>(
    '/api/tmx/import',
    async (req, reply) => {
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: 'No file uploaded' });

      const buffer = await file.toBuffer();
      const modId = req.query.modId ? Number(req.query.modId) : undefined;

      if (modId != null && (!Number.isInteger(modId) || modId < 1)) {
        return reply.code(400).send({ error: 'Invalid modId' });
      }

      log.info(`POST /api/tmx/import filename=${file.filename} size=${buffer.length} modId=${modId ?? 'global'}`);

      const result = await importTmx(db, buffer, modId);
      return reply.send(result);
    },
  );

  /**
   * GET /api/tmx/stats?srcLang=en&targetLang=uk
   *
   * Returns aggregate translation memory statistics for the given language pair:
   * total source strings, how many are translated, coverage percentage (0–100),
   * and a per-status breakdown.
   */
  app.get<{ Querystring: { srcLang?: string; targetLang?: string } }>(
    '/api/tmx/stats',
    async (req, reply) => {
      const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;

      log.debug(`GET /api/tmx/stats srcLang=${srcLang} targetLang=${targetLang}`);

      const { rows } = await db.query(
        `SELECT
           COUNT(DISTINCT s.id)::int                                                           AS total_strings,
           COUNT(DISTINCT t.id)::int                                                           AS translated_strings,
           COUNT(DISTINCT CASE WHEN t.status IN ('human','reviewed') THEN t.id END)::int       AS human,
           COUNT(DISTINCT CASE WHEN t.status = 'tm'                  THEN t.id END)::int       AS tm,
           COUNT(DISTINCT CASE WHEN t.status = 'fuzzy'               THEN t.id END)::int       AS fuzzy,
           COUNT(DISTINCT CASE WHEN t.status IN ('auto','auto_translated') THEN t.id END)::int AS auto,
           COUNT(DISTINCT CASE WHEN t.status = 'draft'               THEN t.id END)::int       AS draft
         FROM strings s
         JOIN records r ON r.id = s.record_id
         LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
         WHERE s.lang = $1`,
        [srcLang, targetLang],
      );

      const row = rows[0] as Record<string, number>;
      const total = row.total_strings ?? 0;
      const translated = row.translated_strings ?? 0;
      // One decimal place, e.g. 82.7
      const coverage = total > 0 ? Math.round((translated / total) * 1000) / 10 : 0;

      return reply.send({
        totalStrings: total,
        translatedStrings: translated,
        coverage,
        byStatus: {
          human: row.human ?? 0,
          tm: row.tm ?? 0,
          fuzzy: row.fuzzy ?? 0,
          auto: row.auto ?? 0,
          draft: row.draft ?? 0,
        },
      });
    },
  );
};

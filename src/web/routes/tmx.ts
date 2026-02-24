/**
 * TMX (Translation Memory eXchange) routes.
 *
 * Provides endpoints for exporting and importing TMX files, enabling
 * interoperability with external translation tools like SDL Trados,
 * memoQ, OmegaT, and others that support the TMX 1.4b standard.
 */

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { log } from '../../logger.js';
import { exportTmx, importTmx } from '../tmxService.js';
import { CONFIG } from '../../config.js';

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
};

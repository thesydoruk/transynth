import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db.js';
import { withTransaction } from '../../db.js';
import type pg from 'pg';
import { log } from '../../logger.js';
import { enforceGlossary } from '../queries.js';
import { CONFIG } from '../../config.js';

export const glossaryRoutes = async (app: FastifyInstance, db: Tx) => {
  // GET /api/glossary?srcLang=&tgtLang=&q=
  app.get<{ Querystring: { srcLang?: string; tgtLang?: string; q?: string } }>('/api/glossary', async (req, reply) => {
    const { srcLang, tgtLang, q } = req.query;
    log.debug(`GET /api/glossary srcLang=${srcLang} tgtLang=${tgtLang} q=${q}`);
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (srcLang) {
      conditions.push(`src_lang = $${idx++}`);
      params.push(srcLang);
    }
    if (tgtLang) {
      conditions.push(`tgt_lang = $${idx++}`);
      params.push(tgtLang);
    }
    if (q) {
      conditions.push(`(term ILIKE $${idx} OR translation ILIKE $${idx})`);
      idx++;
      params.push(`%${q}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT id, term, translation, src_lang, tgt_lang, source, created_at FROM glossary ${where} ORDER BY term ASC LIMIT 500`,
      params,
    );
    return reply.send(rows);
  });

  // POST /api/glossary — add or update a term pair
  app.post<{ Body: { term: string; translation?: string; srcLang?: string; tgtLang?: string; source?: string } }>(
    '/api/glossary',
    async (req, reply) => {
      const { term, translation, srcLang = CONFIG.defaultSrcLang, tgtLang = CONFIG.defaultTgtLang, source = 'manual' } = req.body ?? {};
      if (!term) return reply.code(400).send({ error: 'term is required' });
      log.info(`POST /api/glossary term="${term}" translation="${translation ?? ''}" ${srcLang}→${tgtLang}`);

      await db.query(
        `INSERT INTO glossary(term, translation, src_lang, tgt_lang, source)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT(term, src_lang, tgt_lang) DO UPDATE SET translation = EXCLUDED.translation, source = EXCLUDED.source`,
        [term.trim(), translation?.trim() || null, srcLang, tgtLang, source],
      );

      const { rows } = await db.query(
        `SELECT id, term, translation, src_lang, tgt_lang, source, created_at FROM glossary WHERE term = $1 AND src_lang = $2 AND tgt_lang = $3`,
        [term.trim(), srcLang, tgtLang],
      );

      return reply.code(201).send(rows[0]);
    },
  );

  // DELETE /api/glossary/:id
  app.delete<{ Params: { id: string } }>('/api/glossary/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid id' });

    const result = await db.query(`DELETE FROM glossary WHERE id = $1`, [id]);
    if (result.rowCount === 0) return reply.code(404).send({ error: 'Not found' });

    return reply.send({ ok: true });
  });

  /**
   * POST /api/glossary/enforce — batch-enforce glossary as a QA rule.
   *
   * Re-scans all translated strings (optionally restricted to a single mod)
   * and creates `glossary_violation` QA issues wherever a glossary source term
   * appears in the English source text but the required translation is missing
   * from the target text.  Previous glossary_violation issues in scope are
   * deleted before the scan so the result set is always up-to-date.
   *
   * Body (all optional):
   *   - `modId`      — restrict to a single mod's strings.
   *   - `targetLang` — target language code (default `'uk'`).
   *
   * Returns `{ checked, violations }`.
   */
  app.post<{ Body: { modId?: number; targetLang?: string } }>(
    '/api/glossary/enforce',
    async (req, reply) => {
      const modId = req.body?.modId ? Number(req.body.modId) : undefined;
      const targetLang = req.body?.targetLang ?? CONFIG.defaultTgtLang;

      if (modId !== undefined && (!Number.isInteger(modId) || modId < 1)) {
        return reply.code(400).send({ error: 'Invalid modId' });
      }

      log.info(`POST /api/glossary/enforce modId=${modId ?? 'all'} targetLang=${targetLang}`);

      const result = await withTransaction(db as pg.Pool, async (client) =>
        enforceGlossary(client, { modId, targetLang }),
      );

      return reply.send(result);
    },
  );
}

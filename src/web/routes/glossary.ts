import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { withTransaction } from '../../db';
import type pg from 'pg';
import { log } from '../../logger';
import { enforceGlossary } from '../data/queries';
import { glossaryGameKey } from '../../llm/prompts/resolveGame';
import { CONFIG } from '../../config';

const GLOSSARY_SELECT = 'id, term, translation, src_lang, tgt_lang, game, source, created_at';

export const glossaryRoutes = async (app: FastifyInstance, db: Tx) => {
  // GET /api/glossary?srcLang=&tgtLang=&q=&game=
  app.get<{ Querystring: { srcLang?: string; tgtLang?: string; q?: string; game?: string } }>(
    '/api/glossary',
    async (req, reply) => {
      const { srcLang, tgtLang, q, game } = req.query;
      const gameKey = glossaryGameKey(game);
      log.debug(`GET /api/glossary srcLang=${srcLang} tgtLang=${tgtLang} game=${gameKey} q=${q}`);
      const conditions: string[] = [`game = $1`];
      const params: unknown[] = [gameKey];

      if (srcLang) {
        conditions.push(`src_lang = $${params.length + 1}`);
        params.push(srcLang);
      }
      if (tgtLang) {
        conditions.push(`tgt_lang = $${params.length + 1}`);
        params.push(tgtLang);
      }
      if (q) {
        conditions.push(
          `(term ILIKE $${params.length + 1} OR translation ILIKE $${params.length + 1})`,
        );
        params.push(`%${q}%`);
      }

      const { rows } = await db.query(
        `SELECT ${GLOSSARY_SELECT} FROM glossary WHERE ${conditions.join(' AND ')} ORDER BY term ASC LIMIT 500`,
        params,
      );
      return reply.send(rows);
    },
  );

  // POST /api/glossary — add or update a term pair
  app.post<{
    Body: {
      term: string;
      translation?: string;
      srcLang?: string;
      tgtLang?: string;
      game?: string;
      source?: string;
    };
  }>('/api/glossary', async (req, reply) => {
    const {
      term,
      translation,
      srcLang = CONFIG.defaultSrcLang,
      tgtLang = CONFIG.defaultTgtLang,
      game,
      source = 'manual',
    } = req.body ?? {};
    if (!term) return reply.code(400).send({ error: 'term is required' });
    const gameKey = glossaryGameKey(game);
    log.info(
      `POST /api/glossary term="${term}" translation="${translation ?? ''}" ${srcLang}→${tgtLang} game=${gameKey}`,
    );

    await db.query(
      `INSERT INTO glossary(term, translation, src_lang, tgt_lang, game, source)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT(term, src_lang, tgt_lang, game) DO UPDATE SET translation = EXCLUDED.translation, source = EXCLUDED.source`,
      [term.trim(), translation?.trim() || null, srcLang, tgtLang, gameKey, source],
    );

    const { rows } = await db.query(
      `SELECT ${GLOSSARY_SELECT} FROM glossary WHERE term = $1 AND src_lang = $2 AND tgt_lang = $3 AND game = $4`,
      [term.trim(), srcLang, tgtLang, gameKey],
    );

    return reply.code(201).send(rows[0]);
  });

  // DELETE /api/glossary/:id
  app.delete<{ Params: { id: string } }>('/api/glossary/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid id' });

    const result = await db.query(`DELETE FROM glossary WHERE id = $1`, [id]);
    if (result.rowCount === 0) return reply.code(404).send({ error: 'Not found' });

    return reply.send({ ok: true });
  });

  // PUT /api/glossary/:id — update existing term pair
  app.put<{ Params: { id: string }; Body: { term?: string; translation?: string | null } }>(
    '/api/glossary/:id',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid id' });

      const term = req.body?.term?.trim();
      if (!term) return reply.code(400).send({ error: 'term is required' });
      const translation = req.body?.translation?.trim() || null;

      try {
        const result = await db.query(
          `UPDATE glossary
           SET term = $2,
               translation = $3,
               source = CASE WHEN source = 'manual' THEN 'manual' ELSE source END
           WHERE id = $1`,
          [id, term, translation],
        );

        if ((result.rowCount ?? 0) === 0) return reply.code(404).send({ error: 'Not found' });
      } catch (error) {
        const dbError = error as { code?: string };
        if (dbError.code === '23505') {
          return reply
            .code(409)
            .send({ error: 'A glossary entry with this term/language/game already exists' });
        }
        throw error;
      }

      const { rows } = await db.query(`SELECT ${GLOSSARY_SELECT} FROM glossary WHERE id = $1`, [
        id,
      ]);

      return reply.send(rows[0]);
    },
  );

  /**
   * POST /api/glossary/enforce — batch-enforce glossary as a QA rule.
   *
   * Re-scans translated strings for one game (optionally a single mod)
   * and creates `glossary_violation` QA issues wherever a glossary source term
   * appears in the English source text but the required translation is missing
   * from the target text.  Previous glossary_violation issues in scope are
   * deleted before the scan so the result set is always up-to-date.
   *
   * Body (all optional):
   *   - `modId`      — restrict to a single mod's strings.
   *   - `targetLang` — target language code (default `'uk'`).
   *   - `game`       — game id (default from the mod, else FO4).
   *
   * Returns `{ checked, violations }`.
   */
  app.post<{ Body: { modId?: number; targetLang?: string; game?: string } }>(
    '/api/glossary/enforce',
    async (req, reply) => {
      const modId = req.body?.modId ? Number(req.body.modId) : undefined;
      const targetLang = req.body?.targetLang ?? CONFIG.defaultTgtLang;
      const game = req.body?.game;

      if (modId !== undefined && (!Number.isInteger(modId) || modId < 1)) {
        return reply.code(400).send({ error: 'Invalid modId' });
      }

      log.info(
        `POST /api/glossary/enforce modId=${modId ?? 'all'} targetLang=${targetLang} game=${game ?? 'default'}`,
      );

      const result = await withTransaction(db as pg.Pool, async (client) =>
        enforceGlossary(client, { modId, targetLang, game }),
      );

      return reply.send(result);
    },
  );
};

import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db.js';

export async function glossaryRoutes(app: FastifyInstance, db: Tx) {
  // GET /api/glossary?lang=&q=
  app.get<{ Querystring: { lang?: string; q?: string } }>('/api/glossary', async (req, reply) => {
    const { lang, q } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (lang) {
      conditions.push(`lang = $${idx++}`);
      params.push(lang);
    }
    if (q) {
      conditions.push(`term LIKE $${idx++}`);
      params.push(`%${q}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT id, term, lang, count, source FROM glossary ${where} ORDER BY count DESC LIMIT 500`,
      params,
    );
    return reply.send(rows);
  });

  // POST /api/glossary — add or update a term
  app.post<{ Body: { term: string; lang: string; source?: string } }>(
    '/api/glossary',
    async (req, reply) => {
      const { term, lang, source = 'manual' } = req.body ?? {};
      if (!term || !lang) return reply.code(400).send({ error: 'term and lang are required' });

      await db.query(
        `INSERT INTO glossary(term, lang, count, source)
         VALUES ($1, $2, 1, $3)
         ON CONFLICT(term, lang) DO UPDATE SET count = glossary.count + 1, source = EXCLUDED.source`,
        [term.trim(), lang, source],
      );

      const { rows } = await db.query(
        `SELECT id, term, lang, count, source FROM glossary WHERE term = $1 AND lang = $2`,
        [term.trim(), lang],
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
}

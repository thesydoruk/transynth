import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db.js';

export async function glossaryRoutes(app: FastifyInstance, db: Tx) {
  // GET /api/glossary?lang=&q=
  app.get<{ Querystring: { lang?: string; q?: string } }>('/api/glossary', async (req, reply) => {
    const { lang, q } = req.query;
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (lang) {
      conditions.push('lang = @lang');
      params.lang = lang;
    }
    if (q) {
      conditions.push('term LIKE @q');
      params.q = `%${q}%`;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT rowid AS id, term, lang, count, source FROM glossary ${where} ORDER BY count DESC LIMIT 500`).all(params);
    return reply.send(rows);
  });

  // POST /api/glossary — add or update a term
  app.post<{ Body: { term: string; lang: string; source?: string } }>(
    '/api/glossary',
    async (req, reply) => {
      const { term, lang, source = 'manual' } = req.body ?? {};
      if (!term || !lang) return reply.code(400).send({ error: 'term and lang are required' });

      db.prepare(
        `INSERT INTO glossary(term, lang, count, source)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(term, lang) DO UPDATE SET count = count + 1, source = excluded.source`,
      ).run(term.trim(), lang, source);

      const row = db
        .prepare(`SELECT rowid AS id, term, lang, count, source FROM glossary WHERE term = ? AND lang = ?`)
        .get(term.trim(), lang);

      return reply.code(201).send(row);
    },
  );

  // DELETE /api/glossary/:id
  app.delete<{ Params: { id: string } }>('/api/glossary/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid id' });

    const info = db.prepare(`DELETE FROM glossary WHERE rowid = ?`).run(id);
    if (info.changes === 0) return reply.code(404).send({ error: 'Not found' });

    return reply.send({ ok: true });
  });
}

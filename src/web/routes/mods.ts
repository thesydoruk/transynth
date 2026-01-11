import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db.js';
import { listMods, getMod, getModStats, diffMods } from '../queries.js';
import { applyTMToMod } from '../tm.js';

export async function modsRoutes(app: FastifyInstance, db: Tx) {
  // GET /api/mods — list all mods with aggregate stats
  app.get('/api/mods', async (_req, reply) => {
    const mods = await listMods(db);
    return reply.send(mods);
  });

  // GET /api/mods/:id — single mod with progress stats
  app.get<{ Params: { id: string } }>('/api/mods/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

    const mod = await getMod(db, id);
    if (!mod) return reply.code(404).send({ error: 'Not found' });

    const stats = await getModStats(db, id);
    return reply.send({ ...(mod as object), stats });
  });

  // POST /api/mods/:id/tm-apply — auto-fill untranslated strings from TM
  app.post<{ Params: { id: string }; Querystring: { targetLang?: string } }>(
    '/api/mods/:id/tm-apply',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

      const targetLang = req.query.targetLang ?? 'uk';
      const result = await applyTMToMod(db, id, targetLang);
      return reply.send(result);
    },
  );

  // GET /api/mods/:id/diff?compareModId= — compare two mod versions
  app.get<{ Params: { id: string }; Querystring: { compareModId?: string; targetLang?: string } }>(
    '/api/mods/:id/diff',
    async (req, reply) => {
      const newId = Number(req.params.id);
      const oldId = Number(req.query.compareModId);
      if (!Number.isInteger(newId) || newId < 1) return reply.code(400).send({ error: 'Invalid mod id' });
      if (!Number.isInteger(oldId) || oldId < 1) return reply.code(400).send({ error: 'compareModId is required' });

      const targetLang = req.query.targetLang ?? 'uk';
      const result = await diffMods(db, newId, oldId, targetLang);
      return reply.send(result);
    },
  );
}

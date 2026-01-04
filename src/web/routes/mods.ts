import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db.js';
import { listMods, getMod, getModStats } from '../queries.js';

export async function modsRoutes(app: FastifyInstance, db: Tx) {
  // GET /api/mods — list all mods with aggregate stats
  app.get('/api/mods', async (_req, reply) => {
    const mods = listMods(db);
    return reply.send(mods);
  });

  // GET /api/mods/:id — single mod with progress stats
  app.get<{ Params: { id: string } }>('/api/mods/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

    const mod = getMod(db, id);
    if (!mod) return reply.code(404).send({ error: 'Not found' });

    const stats = getModStats(db, id);
    return reply.send({ ...mod as object, stats });
  });
}

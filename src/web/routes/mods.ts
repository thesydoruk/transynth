import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db.js';
import { listMods, getMod, getModStats, diffMods, listModLangs } from '../queries.js';
import { applyTMToMod } from '../tm.js';
import { log } from '../../logger.js';

export async function modsRoutes(app: FastifyInstance, db: Tx) {
  // GET /api/mods — list all mods with aggregate stats
  app.get('/api/mods', async (_req, reply) => {
    log.debug('GET /api/mods');
    const mods = await listMods(db);
    log.trace(`GET /api/mods → ${mods.length} mods`);
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

  // GET /api/mods/:id/langs — list all languages available in this mod
  app.get<{ Params: { id: string } }>('/api/mods/:id/langs', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });
    const langs = await listModLangs(db, id);
    return reply.send(langs);
  });

  // POST /api/mods/:id/tm-apply — auto-fill untranslated strings from TM
  app.post<{ Params: { id: string }; Querystring: { targetLang?: string } }>(
    '/api/mods/:id/tm-apply',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

      const targetLang = req.query.targetLang ?? 'uk';
      log.info(`POST /api/mods/${id}/tm-apply lang=${targetLang}`);
      const result = await applyTMToMod(db, id, targetLang);
      log.info(`TM apply result: applied=${result.applied}, skipped=${result.skipped}`);
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

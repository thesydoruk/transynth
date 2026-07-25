import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../../db';
import {
  listMods,
  getMod,
  listModLangs,
  listPreviousVersions,
  clearSameAsSourceTranslations,
  deleteModData,
} from '../../data/queries';
import { getPexSourceSnippetForString } from '../../export/pexDecompileService';
import { deleteModsCompletely } from '../../import/modDeleteService';
import { log } from '../../../logger';
import { CONFIG } from '../../../config';

export const registerListCrudRoutes = async (app: FastifyInstance, db: Tx) => {
  // GET /api/mods — list all mods with aggregate stats.
  // Optional query params: ?game=fo4&srcLang=en&targetLang=uk
  app.get<{ Querystring: { game?: string; srcLang?: string; targetLang?: string } }>(
    '/api/mods',
    async (req, reply) => {
      const { game, srcLang, targetLang } = req.query;
      log.debug(`GET /api/mods game=${game ?? 'all'}`);
      const mods = await listMods(db, { game, srcLang, targetLang });
      log.trace(`GET /api/mods → ${mods.length} mods`);
      return reply.send(mods);
    },
  );

  // GET /api/mods/:id — mod metadata (progress breakdown: GET /api/stats?modId=)
  app.get<{ Params: { id: string } }>('/api/mods/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

    const mod = await getMod(db, id);
    if (!mod) return reply.code(404).send({ error: 'Not found' });

    return reply.send(mod);
  });

  // GET /api/mods/:id/pex-source/:stringId — decompile PEX and return PSC context for one row.
  app.get<{ Params: { id: string; stringId: string } }>(
    '/api/mods/:id/pex-source/:stringId',
    async (req, reply) => {
      const modId = Number(req.params.id);
      const stringId = Number(req.params.stringId);
      if (!Number.isInteger(modId) || modId < 1) {
        return reply.code(400).send({ error: 'Invalid mod id' });
      }
      if (!Number.isInteger(stringId) || stringId < 1) {
        return reply.code(400).send({ error: 'Invalid string id' });
      }

      const mod = await getMod(db, modId);
      if (!mod) return reply.code(404).send({ error: 'Not found' });

      const result = await getPexSourceSnippetForString(db, modId, stringId);
      if (!result.ok) {
        const status =
          result.reason === 'string_not_found' || result.reason === 'mod_not_found'
            ? 404
            : result.reason === 'not_pex'
              ? 400
              : 503;
        return reply.code(status).send(result);
      }

      return reply.send(result);
    },
  );

  // POST /api/mods/batch-delete — remove multiple mods in one DB transaction.
  app.post<{ Body: { modIds?: number[] } }>('/api/mods/batch-delete', async (req, reply) => {
    const modIds = req.body?.modIds;
    if (!Array.isArray(modIds) || modIds.length === 0) {
      return reply.code(400).send({ error: 'modIds must be a non-empty array' });
    }
    if (modIds.length > 100) {
      return reply.code(400).send({ error: 'Too many mods in one batch (max 100)' });
    }
    if (!modIds.every((id) => Number.isInteger(id) && id > 0)) {
      return reply.code(400).send({ error: 'Invalid mod id in modIds' });
    }

    const result = await deleteModsCompletely(db, modIds);
    log.info(
      `POST /api/mods/batch-delete deletedMods=${result.deletedMods} deletedRecords=${result.deletedRecords}`,
    );
    return reply.send({ ok: true, ...result });
  });

  // DELETE /api/mods/:id/rows — remove all imported rows for a mod but keep the mod entry.
  app.delete<{ Params: { id: string } }>('/api/mods/:id/rows', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

    const mod = await getMod(db, id);
    if (!mod) return reply.code(404).send({ error: 'Not found' });

    const result = await deleteModData(db, id, 'rows');
    log.info(`DELETE /api/mods/${id}/rows deletedRecords=${result.deletedRecords}`);
    return reply.send({ ok: true, deletedRecords: result.deletedRecords });
  });

  // DELETE /api/mods/:id — remove the mod entry and all related records/strings/translations.
  app.delete<{ Params: { id: string } }>('/api/mods/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

    const mod = await getMod(db, id);
    if (!mod) return reply.code(404).send({ error: 'Not found' });

    const result = await deleteModsCompletely(db, [id]);
    if (result.deletedMods === 0) return reply.code(404).send({ error: 'Not found' });
    log.info(`DELETE /api/mods/${id} deletedRecords=${result.deletedRecords}`);
    return reply.send({ ok: true, deletedRecords: result.deletedRecords });
  });

  // GET /api/mods/:id/langs — list all languages available in this mod
  app.get<{ Params: { id: string } }>('/api/mods/:id/langs', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });
    const langs = await listModLangs(db, id);
    return reply.send(langs);
  });

  // GET /api/mods/:id/previous-versions — list older versions of this mod (same name, different hash)
  app.get<{ Params: { id: string } }>('/api/mods/:id/previous-versions', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });
    const rows = await listPreviousVersions(db, id);
    return reply.send(rows);
  });

  // POST /api/mods/:id/clear-same-as-source — remove translations identical to source
  app.post<{
    Params: { id: string };
    Querystring: { srcLang?: string; targetLang?: string };
  }>('/api/mods/:id/clear-same-as-source', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

    const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
    const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
    log.info(`POST /api/mods/${id}/clear-same-as-source ${srcLang}->${targetLang}`);
    const result = await clearSameAsSourceTranslations(db, id, srcLang, targetLang);
    log.info(`Clear same-as-source: cleared=${result.cleared}`);
    return reply.send(result);
  });
};

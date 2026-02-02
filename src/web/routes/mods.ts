import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db.js';
import { listMods, getMod, getModStats, diffMods, carryOverTranslations, listModLangs, bulkUpdateTranslationStatus, listPreviousVersions } from '../queries.js';
import { applyTMToMod } from '../tm.js';
import { log } from '../../logger.js';
import { exportBa2Archive, exportLocalizedStringsFiles, exportPatchedEsp, exportProjectZip } from '../exportService.js';

export const modsRoutes = async (app: FastifyInstance, db: Tx) => {
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

  // GET /api/mods/:id/previous-versions — list older versions of this mod (same name, different hash)
  app.get<{ Params: { id: string } }>('/api/mods/:id/previous-versions', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });
    const rows = await listPreviousVersions(db, id);
    return reply.send(rows);
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

  // POST /api/mods/:id/carry-over?fromModId=&targetLang= — copy translations from old mod version
  app.post<{ Params: { id: string }; Querystring: { fromModId?: string; targetLang?: string } }>(
    '/api/mods/:id/carry-over',
    async (req, reply) => {
      const newModId = Number(req.params.id);
      const oldModId = Number(req.query.fromModId);
      if (!Number.isInteger(newModId) || newModId < 1) return reply.code(400).send({ error: 'Invalid mod id' });
      if (!Number.isInteger(oldModId) || oldModId < 1) return reply.code(400).send({ error: 'fromModId query param is required' });

      const targetLang = req.query.targetLang ?? 'uk';
      log.info(`POST /api/mods/${newModId}/carry-over fromModId=${oldModId} targetLang=${targetLang}`);

      try {
        const result = await carryOverTranslations(db, newModId, oldModId, targetLang);
        return reply.send(result);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // GET /api/mods/:id/export/strings?srcLang=&targetLang= — generate localized STRINGS files
  app.get<{ Params: { id: string }; Querystring: { srcLang?: string; targetLang?: string } }>(
    '/api/mods/:id/export/strings',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

      const mod = await getMod(db, id);
      if (!mod) return reply.code(404).send({ error: 'Not found' });

      const srcLang = req.query.srcLang ?? 'en';
      const targetLang = req.query.targetLang ?? 'uk';
      if (!mod.abs_path) return reply.code(400).send({ error: 'Mod file path is not available for export' });

      try {
        const files = await exportLocalizedStringsFiles(db, id, mod.abs_path, srcLang, targetLang);
        return reply.send({ modId: id, srcLang, targetLang, files });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // GET /api/mods/:id/export/esp?srcLang=&targetLang= — patch non-localized ESP with translations
  app.get<{ Params: { id: string }; Querystring: { srcLang?: string; targetLang?: string } }>(
    '/api/mods/:id/export/esp',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

      const mod = await getMod(db, id);
      if (!mod) return reply.code(404).send({ error: 'Not found' });

      const srcLang = req.query.srcLang ?? 'en';
      const targetLang = req.query.targetLang ?? 'uk';
      if (!mod.abs_path) return reply.code(400).send({ error: 'Mod file path is not available for export' });

      try {
        const file = await exportPatchedEsp(db, id, mod.abs_path, srcLang, targetLang);
        return reply.send({ modId: id, srcLang, targetLang, files: [file] });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // GET /api/mods/:id/export/ba2?srcLang=&targetLang= — pack localized STRINGS into BA2 archive
  app.get<{ Params: { id: string }; Querystring: { srcLang?: string; targetLang?: string } }>(
    '/api/mods/:id/export/ba2',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

      const mod = await getMod(db, id);
      if (!mod) return reply.code(404).send({ error: 'Not found' });

      const srcLang = req.query.srcLang ?? 'en';
      const targetLang = req.query.targetLang ?? 'uk';
      if (!mod.abs_path) return reply.code(400).send({ error: 'Mod file path is not available for export' });

      try {
        const file = await exportBa2Archive(db, id, mod.abs_path, srcLang, targetLang);
        return reply.send({ modId: id, srcLang, targetLang, files: [file] });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // GET /api/mods/:id/export/project?srcLang=&targetLang= — full project ZIP (BA2 + ESP)
  app.get<{ Params: { id: string }; Querystring: { srcLang?: string; targetLang?: string } }>(
    '/api/mods/:id/export/project',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

      const mod = await getMod(db, id);
      if (!mod) return reply.code(404).send({ error: 'Not found' });

      const srcLang = req.query.srcLang ?? 'en';
      const targetLang = req.query.targetLang ?? 'uk';
      if (!mod.abs_path) return reply.code(400).send({ error: 'Mod file path is not available for export' });

      try {
        const { zipBuffer, zipFileName } = await exportProjectZip(db, id, mod.abs_path, srcLang, targetLang);
        return reply
          .header('Content-Type', 'application/zip')
          .header('Content-Disposition', `attachment; filename="${zipFileName}"`)
          .send(zipBuffer);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // PATCH /api/mods/:id/bulk-review — batch approve/reject selected strings
  app.patch<{
    Params: { id: string };
    Body: { stringIds: number[]; status: 'reviewed' | 'rejected'; targetLang?: string };
  }>('/api/mods/:id/bulk-review', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

    const { stringIds, status, targetLang = 'uk' } = req.body;
    if (!Array.isArray(stringIds) || stringIds.length === 0) return reply.code(400).send({ error: 'stringIds is required' });
    if (status !== 'reviewed' && status !== 'rejected') return reply.code(400).send({ error: 'status must be reviewed or rejected' });

    log.info(`PATCH /api/mods/${id}/bulk-review status=${status} count=${stringIds.length}`);
    const updated = await bulkUpdateTranslationStatus(db, id, stringIds, status, targetLang);
    return reply.send({ updated });
  });
}

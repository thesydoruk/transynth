import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import {
  listMods,
  getMod,
  getModStats,
  diffMods,
  carryOverTranslations,
  applyImportedModStringsAsTranslations,
  listModLangs,
  bulkUpdateTranslationStatus,
  listPreviousVersions,
} from '../queries';
import { applyTMToMod } from '../tm';
import {
  findRunningApplyImportedJob,
  getApplyImportedJob,
  requestApplyImportedStop,
  runApplyImportedJob,
  scheduleApplyImportedJobCleanup,
} from '../applyImportedJobService';
import { log } from '../../logger';
import { CONFIG } from '../../config';
import {
  exportArchive,
  exportLocalizedStringsFiles,
  exportPatchedEsp,
  exportProjectZip,
} from '../exportService';
import type { GameType } from '../../types';

export const modsRoutes = async (app: FastifyInstance, db: Tx) => {
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

  // GET /api/mods/:id — single mod with progress stats
  app.get<{ Params: { id: string } }>('/api/mods/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

    const mod = await getMod(db, id);
    if (!mod) return reply.code(404).send({ error: 'Not found' });

    const stats = await getModStats(db, id);
    return reply.send({ ...(mod as object), stats });
  });

  // DELETE /api/mods/:id/rows — remove all imported rows for a mod but keep the mod entry.
  app.delete<{ Params: { id: string } }>('/api/mods/:id/rows', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

    const mod = await getMod(db, id);
    if (!mod) return reply.code(404).send({ error: 'Not found' });

    const result = await db.query('DELETE FROM records WHERE mod_id = $1', [id]);
    log.info(`DELETE /api/mods/${id}/rows deletedRecords=${result.rowCount ?? 0}`);
    return reply.send({ ok: true, deletedRecords: result.rowCount ?? 0 });
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

      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
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
      if (!Number.isInteger(newId) || newId < 1)
        return reply.code(400).send({ error: 'Invalid mod id' });
      if (!Number.isInteger(oldId) || oldId < 1)
        return reply.code(400).send({ error: 'compareModId is required' });

      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
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
      if (!Number.isInteger(newModId) || newModId < 1)
        return reply.code(400).send({ error: 'Invalid mod id' });
      if (!Number.isInteger(oldModId) || oldModId < 1)
        return reply.code(400).send({ error: 'fromModId query param is required' });

      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      log.info(
        `POST /api/mods/${newModId}/carry-over fromModId=${oldModId} targetLang=${targetLang}`,
      );

      try {
        const result = await carryOverTranslations(db, newModId, oldModId, targetLang);
        return reply.send(result);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // POST /api/mods/:id/apply-imported?fromModId=&importedLang=&srcLang=
  // Apply raw strings from imported translation mod to a base mod as translations.
  app.post<{
    Params: { id: string };
    Querystring: {
      fromModId?: string;
      importedLang?: string;
      srcLang?: string;
      targetLang?: string;
    };
  }>('/api/mods/:id/apply-imported', async (req, reply) => {
    const targetModId = Number(req.params.id);
    const fromModId = Number(req.query.fromModId);
    if (!Number.isInteger(targetModId) || targetModId < 1) {
      return reply.code(400).send({ error: 'Invalid mod id' });
    }
    if (!Number.isInteger(fromModId) || fromModId < 1) {
      return reply.code(400).send({ error: 'fromModId query param is required' });
    }

    const importedLang = (req.query.importedLang ?? '').trim();
    if (!importedLang) {
      return reply.code(400).send({ error: 'importedLang query param is required' });
    }

    const srcLang = (req.query.srcLang ?? CONFIG.defaultSrcLang).trim() || CONFIG.defaultSrcLang;
    const targetLang = (req.query.targetLang ?? importedLang).trim() || importedLang;

    log.info(
      `POST /api/mods/${targetModId}/apply-imported fromModId=${fromModId} ` +
        `importedLang=${importedLang} targetLang=${targetLang} srcLang=${srcLang}`,
    );

    try {
      const result = await applyImportedModStringsAsTranslations(
        db,
        targetModId,
        fromModId,
        importedLang,
        targetLang,
        srcLang,
      );

      return reply.send(result);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // POST /api/mods/:id/apply-imported/stream — SSE progress stream
  app.post<{
    Params: { id: string };
    Body: { fromModId?: number; importedLang?: string; srcLang?: string; targetLang?: string };
  }>('/api/mods/:id/apply-imported/stream', async (req, reply) => {
    const targetModId = Number(req.params.id);
    const fromModId = Number(req.body?.fromModId);
    if (!Number.isInteger(targetModId) || targetModId < 1) {
      return reply.code(400).send({ error: 'Invalid mod id' });
    }
    if (!Number.isInteger(fromModId) || fromModId < 1) {
      return reply.code(400).send({ error: 'fromModId is required' });
    }

    const importedLang = (req.body?.importedLang ?? '').trim();
    if (!importedLang) {
      return reply.code(400).send({ error: 'importedLang is required' });
    }

    const srcLang = (req.body?.srcLang ?? CONFIG.defaultSrcLang).trim() || CONFIG.defaultSrcLang;
    const targetLang =
      (req.body?.targetLang ?? CONFIG.defaultTgtLang).trim() || CONFIG.defaultTgtLang;

    const runningJobId = findRunningApplyImportedJob(targetModId);
    if (runningJobId != null) {
      return reply
        .code(409)
        .send({ error: `Apply-imported already running (job #${runningJobId})` });
    }

    req.raw.socket.setTimeout(0);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (data: object) => {
      try {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      } catch {
        /* client disconnected — job continues */
      }
    };

    let finishedJobId: number | null = null;

    void (async () => {
      try {
        const snapshot = await runApplyImportedJob(
          db,
          { targetModId, fromModId, importedLang, srcLang, targetLang },
          send,
        );
        finishedJobId = snapshot.jobId;
      } catch (err: unknown) {
        log.error(
          `[Apply-imported mod #${targetModId}] Stream error: ${err instanceof Error ? err.message : String(err)}`,
        );
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      } finally {
        if (finishedJobId != null) scheduleApplyImportedJobCleanup(finishedJobId);
        try {
          reply.raw.end();
        } catch {
          /* already closed */
        }
      }
    })();
  });

  app.post<{ Params: { jobId: string } }>('/api/apply-imported/:jobId/stop', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    if (!requestApplyImportedStop(jobId)) {
      return reply.code(404).send({ error: 'Running apply-imported job not found' });
    }
    return reply.send({ ok: true });
  });

  app.get<{ Params: { jobId: string } }>('/api/apply-imported/:jobId', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    const job = getApplyImportedJob(jobId);
    if (!job) return reply.code(404).send({ error: 'Apply-imported job not found' });
    return reply.send(job);
  });

  // GET /api/mods/:id/export/strings?srcLang=&targetLang= — generate localized STRINGS files
  app.get<{ Params: { id: string }; Querystring: { srcLang?: string; targetLang?: string } }>(
    '/api/mods/:id/export/strings',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

      const mod = await getMod(db, id);
      if (!mod) return reply.code(404).send({ error: 'Not found' });

      const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      if (!mod.abs_path)
        return reply.code(400).send({ error: 'Mod file path is not available for export' });

      try {
        const game = (mod.game ?? 'fo4') as GameType;
        const files = await exportLocalizedStringsFiles(
          db,
          id,
          mod.abs_path,
          srcLang,
          targetLang,
          game,
        );
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

      const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      if (!mod.abs_path)
        return reply.code(400).send({ error: 'Mod file path is not available for export' });

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

      const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      if (!mod.abs_path)
        return reply.code(400).send({ error: 'Mod file path is not available for export' });

      try {
        const game = (mod.game ?? 'fo4') as GameType;
        const file = await exportArchive(db, id, mod.abs_path, srcLang, targetLang, game);
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

      const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      if (!mod.abs_path)
        return reply.code(400).send({ error: 'Mod file path is not available for export' });

      try {
        const game = (mod.game ?? 'fo4') as GameType;
        const { zipBuffer, zipFileName } = await exportProjectZip(
          db,
          id,
          mod.abs_path,
          srcLang,
          targetLang,
          game,
        );
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

    const { stringIds, status, targetLang = CONFIG.defaultTgtLang } = req.body;
    if (!Array.isArray(stringIds) || stringIds.length === 0)
      return reply.code(400).send({ error: 'stringIds is required' });
    if (status !== 'reviewed' && status !== 'rejected')
      return reply.code(400).send({ error: 'status must be reviewed or rejected' });

    const actor = req.user?.role ?? 'translator';
    log.info(
      `PATCH /api/mods/${id}/bulk-review status=${status} count=${stringIds.length} actor=${actor}`,
    );
    const updated = await bulkUpdateTranslationStatus(db, id, stringIds, status, targetLang, actor);
    return reply.send({ updated });
  });
};

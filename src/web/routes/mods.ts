import fs from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Tx } from '../../db';
import {
  listMods,
  getMod,
  getModStats,
  diffMods,
  carryOverTranslations,
  applyImportedModStringsAsTranslations,
  listModLangs,
  listPreviousVersions,
  clearSameAsSourceTranslations,
  deleteModData,
} from '../data/queries';
import {
  findRunningApplyImportedJob,
  getApplyImportedJob,
  requestApplyImportedStop,
  runApplyImportedJob,
  scheduleApplyImportedJobCleanup,
} from '../import/applyImportedJobService';
import { log } from '../../logger';
import { CONFIG } from '../../config';
import { tryRefreshModLangStats } from '../services/modLangStats';
import { exportFullModZip, exportLangpackZip } from '../export/exportService';
import { getPexSourceSnippetForString } from '../export/pexDecompileService';
import {
  clearVoiceSpeakerReferenceForMod,
  generateVoiceTranslationForMod,
  getVoicePreviewWav,
  getVoiceTranslationWav,
  listVoiceLinesForMod,
  setVoiceSpeakerReferenceForMod,
} from '../voice/voicePreviewService';
import { deleteModsCompletely } from '../import/modDeleteService';
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

  // GET /api/mods/:id/voice/lines — list voice lines grouped by speaker.
  app.get<{
    Params: { id: string };
    Querystring: { srcLang?: string; targetLang?: string };
  }>('/api/mods/:id/voice/lines', async (req, reply) => {
    const modId = Number(req.params.id);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid mod id' });
    }

    const srcLang = req.query.srcLang?.trim() || CONFIG.defaultSrcLang;
    const targetLang = req.query.targetLang?.trim() || CONFIG.defaultTgtLang;
    const result = await listVoiceLinesForMod(db, modId, srcLang, targetLang);
    if (!result.ok) {
      const status =
        result.reason === 'mod_not_found' ? 404 : result.reason === 'no_voice_files' ? 404 : 400;
      return reply.code(status).send(result);
    }
    return reply.send(result);
  });

  // GET /api/mods/:id/voice/audio/:formidLower6/:variant — stream cached preview WAV.
  app.get<{ Params: { id: string; formidLower6: string; variant: string } }>(
    '/api/mods/:id/voice/audio/:formidLower6/:variant',
    async (req, reply) => {
      const modId = Number(req.params.id);
      const formidLower6 = req.params.formidLower6.trim();
      const variant = Number.parseInt(req.params.variant, 10);
      if (!Number.isInteger(modId) || modId < 1) {
        return reply.code(400).send({ error: 'Invalid mod id' });
      }
      if (!/^[0-9A-Fa-f]{6}$/.test(formidLower6)) {
        return reply.code(400).send({ error: 'Invalid formid' });
      }
      if (!Number.isInteger(variant) || variant < 1) {
        return reply.code(400).send({ error: 'Invalid variant' });
      }

      const result = await getVoicePreviewWav(db, modId, formidLower6, variant);
      if (!result.ok) {
        const status =
          result.reason === 'mod_not_found' || result.reason === 'line_not_found'
            ? 404
            : result.reason === 'convert_failed'
              ? 503
              : 400;
        return reply.code(status).send(result);
      }

      return reply.type('audio/wav').send(fs.createReadStream(result.wavPath));
    },
  );

  // GET /api/mods/:id/voice/translation-audio/:formidLower6/:variant — stream synthesized TTS WAV.
  app.get<{ Params: { id: string; formidLower6: string; variant: string } }>(
    '/api/mods/:id/voice/translation-audio/:formidLower6/:variant',
    async (req, reply) => {
      const modId = Number(req.params.id);
      const formidLower6 = req.params.formidLower6.trim();
      const variant = Number.parseInt(req.params.variant, 10);
      if (!Number.isInteger(modId) || modId < 1) {
        return reply.code(400).send({ error: 'Invalid mod id' });
      }
      if (!/^[0-9A-Fa-f]{6}$/.test(formidLower6)) {
        return reply.code(400).send({ error: 'Invalid formid' });
      }
      if (!Number.isInteger(variant) || variant < 1) {
        return reply.code(400).send({ error: 'Invalid variant' });
      }

      const result = await getVoiceTranslationWav(db, modId, formidLower6, variant);
      if (!result.ok) {
        const status =
          result.reason === 'mod_not_found' || result.reason === 'line_not_found'
            ? 404
            : result.reason === 'translation_not_generated'
              ? 404
              : 400;
        return reply.code(status).send(result);
      }

      return reply.type('audio/wav').send(fs.createReadStream(result.wavPath));
    },
  );

  // POST /api/mods/:id/voice/translation-audio/:formidLower6/:variant — synthesize one line.
  app.post<{
    Params: { id: string; formidLower6: string; variant: string };
    Querystring: { srcLang?: string; targetLang?: string };
  }>('/api/mods/:id/voice/translation-audio/:formidLower6/:variant', async (req, reply) => {
    const modId = Number(req.params.id);
    const formidLower6 = req.params.formidLower6.trim();
    const variant = Number.parseInt(req.params.variant, 10);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid mod id' });
    }
    if (!/^[0-9A-Fa-f]{6}$/.test(formidLower6)) {
      return reply.code(400).send({ error: 'Invalid formid' });
    }
    if (!Number.isInteger(variant) || variant < 1) {
      return reply.code(400).send({ error: 'Invalid variant' });
    }

    const srcLang = req.query.srcLang?.trim() || CONFIG.defaultSrcLang;
    const targetLang = req.query.targetLang?.trim() || CONFIG.defaultTgtLang;
    const result = await generateVoiceTranslationForMod(
      db,
      modId,
      formidLower6,
      variant,
      srcLang,
      targetLang,
    );
    if (!result.ok) {
      const status =
        result.reason === 'mod_not_found' || result.reason === 'line_not_found'
          ? 404
          : result.reason === 'tts_failed'
            ? 503
            : 400;
      return reply.code(status).send(result);
    }
    return reply.send(result);
  });

  // PUT /api/mods/:id/voice/speaker-ref — set TTS reference line for one speaker.
  app.put<{
    Params: { id: string };
    Body: { speakerKey?: string; formidLower6?: string; variant?: number };
  }>('/api/mods/:id/voice/speaker-ref', async (req, reply) => {
    const modId = Number(req.params.id);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid mod id' });
    }

    const speakerKey = req.body?.speakerKey?.trim() ?? '';
    const formidLower6 = req.body?.formidLower6?.trim() ?? '';
    const variant = Number(req.body?.variant);
    if (!speakerKey) return reply.code(400).send({ error: 'speakerKey is required' });
    if (!/^[0-9A-Fa-f]{6}$/.test(formidLower6)) {
      return reply.code(400).send({ error: 'Invalid formidLower6' });
    }
    if (!Number.isInteger(variant) || variant < 1) {
      return reply.code(400).send({ error: 'Invalid variant' });
    }

    const result = await setVoiceSpeakerReferenceForMod(
      db,
      modId,
      speakerKey,
      formidLower6,
      variant,
    );
    if (!result.ok) {
      const status =
        result.reason === 'mod_not_found' || result.reason === 'line_not_found'
          ? 404
          : result.reason === 'line_not_in_speaker'
            ? 400
            : 400;
      return reply.code(status).send(result);
    }
    return reply.send(result);
  });

  // DELETE /api/mods/:id/voice/speaker-ref/:speakerKey — clear saved TTS reference.
  app.delete<{ Params: { id: string; speakerKey: string } }>(
    '/api/mods/:id/voice/speaker-ref/:speakerKey',
    async (req, reply) => {
      const modId = Number(req.params.id);
      if (!Number.isInteger(modId) || modId < 1) {
        return reply.code(400).send({ error: 'Invalid mod id' });
      }

      const speakerKey = decodeURIComponent(req.params.speakerKey).trim();
      const result = await clearVoiceSpeakerReferenceForMod(db, modId, speakerKey);
      if (!result.ok) {
        const status = result.reason === 'mod_not_found' ? 404 : 400;
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
    tryRefreshModLangStats(db, id, srcLang, targetLang);
    return reply.send(result);
  });

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

  const sendModExportZip = async (
    reply: FastifyReply,
    modId: number,
    modPath: string,
    srcLang: string,
    targetLang: string,
    game: GameType,
    buildZip: typeof exportLangpackZip,
  ) => {
    try {
      const { zipBuffer, zipFileName } = await buildZip(
        db,
        modId,
        modPath,
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
  };

  // GET /api/mods/:id/export/langpack — ZIP with loose changed localization files (no BA2)
  app.get<{ Params: { id: string }; Querystring: { srcLang?: string; targetLang?: string } }>(
    '/api/mods/:id/export/langpack',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

      const mod = await getMod(db, id);
      if (!mod) return reply.code(404).send({ error: 'Not found' });

      const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      if (!mod.abs_path)
        return reply.code(400).send({ error: 'Mod file path is not available for export' });

      const game = (mod.game ?? 'fo4') as GameType;
      return sendModExportZip(
        reply,
        id,
        mod.abs_path,
        srcLang,
        targetLang,
        game,
        exportLangpackZip,
      );
    },
  );

  // GET /api/mods/:id/export/full-mod — ZIP with BA2/BSA archive (+ patched ESP when needed)
  app.get<{ Params: { id: string }; Querystring: { srcLang?: string; targetLang?: string } }>(
    '/api/mods/:id/export/full-mod',
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid mod id' });

      const mod = await getMod(db, id);
      if (!mod) return reply.code(404).send({ error: 'Not found' });

      const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
      const targetLang = req.query.targetLang ?? CONFIG.defaultTgtLang;
      if (!mod.abs_path)
        return reply.code(400).send({ error: 'Mod file path is not available for export' });

      const game = (mod.game ?? 'fo4') as GameType;
      return sendModExportZip(reply, id, mod.abs_path, srcLang, targetLang, game, exportFullModZip);
    },
  );
};

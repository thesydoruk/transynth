import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Tx } from '../../../db';
import type { GameType } from '../../../types';
import { getMod } from '../../data/queries';
import { exportFullModZip, exportLangpackZip } from '../../export';
import { CONFIG } from '../../../config';
import { resolveModStoredPath } from '../../../modStorage';
import { startLangpackExport } from '../../services/startLangpackExport';

const sendModExportZip = async (
  db: Tx,
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

export const registerExportRoutes = async (app: FastifyInstance, db: Tx) => {
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
      const modPath = resolveModStoredPath(mod.abs_path);
      return sendModExportZip(db, reply, id, modPath, srcLang, targetLang, game, exportLangpackZip);
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
      const modPath = resolveModStoredPath(mod.abs_path);
      return sendModExportZip(db, reply, id, modPath, srcLang, targetLang, game, exportFullModZip);
    },
  );

  // POST /api/mods/batch-export/langpack — start a background ZIP job (no RAM buffer)
  app.post<{
    Body: { modIds?: number[]; srcLang?: string; targetLang?: string };
  }>('/api/mods/batch-export/langpack', async (req, reply) => {
    const result = await startLangpackExport(db, {
      modIds: req.body?.modIds ?? [],
      srcLang: req.body?.srcLang,
      targetLang: req.body?.targetLang,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return reply.send({ ok: true, archive: result.archive, jobId: result.jobId });
  });
};

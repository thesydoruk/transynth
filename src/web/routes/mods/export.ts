import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Tx } from '../../../db';
import type { GameType } from '../../../types';
import { getMod, getModsByIds } from '../../data/queries';
import {
  exportFullModZip,
  exportLangpackZip,
  exportLangpackZipBatch,
  type LangpackBatchMod,
} from '../../export';
import { CONFIG } from '../../../config';
import { resolveModStoredPath } from '../../../modStorage';
import { log } from '../../../logger';

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

  // POST /api/mods/batch-export/langpack — one Vortex-installable ZIP for many mods
  app.post<{
    Body: { modIds?: number[]; srcLang?: string; targetLang?: string };
  }>('/api/mods/batch-export/langpack', async (req, reply) => {
    const parsed = parseModIdList(req.body?.modIds);
    if ('error' in parsed) return reply.code(400).send({ error: parsed.error });

    const srcLang = req.body?.srcLang ?? CONFIG.defaultSrcLang;
    const targetLang = req.body?.targetLang ?? CONFIG.defaultTgtLang;
    const rows = await getModsByIds(db, parsed.modIds);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const targets: LangpackBatchMod[] = [];
    for (const id of parsed.modIds) {
      const mod = byId.get(id);
      if (!mod?.abs_path) continue;
      targets.push({
        modId: id,
        modPath: resolveModStoredPath(mod.abs_path),
        game: (mod.game ?? 'fo4') as GameType,
      });
    }
    if (targets.length === 0) {
      return reply.code(400).send({ error: 'No exportable mods in selection' });
    }

    try {
      const { zipBuffer, zipFileName } = await exportLangpackZipBatch(
        db,
        targets,
        srcLang,
        targetLang,
      );
      log.info(
        `POST /api/mods/batch-export/langpack mods=${targets.length} bytes=${zipBuffer.length}`,
      );
      return reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', `attachment; filename="${zipFileName}"`)
        .send(zipBuffer);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
};

const parseModIdList = (modIds: number[] | undefined): { modIds: number[] } | { error: string } => {
  if (!Array.isArray(modIds) || modIds.length === 0) {
    return { error: 'modIds must be a non-empty array' };
  }
  if (modIds.length > 100) {
    return { error: 'Too many mods in one batch (max 100)' };
  }
  if (!modIds.every((id) => Number.isInteger(id) && id > 0)) {
    return { error: 'Invalid mod id in modIds' };
  }
  return { modIds };
};

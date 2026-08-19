import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { log } from '../../logger';
import { requestJobStop } from '../../../worker/src/core/queue';
import { deleteExportArchiveRow, getExportArchive, listExportArchives } from '../data/queries';
import { removeExportArchiveFiles, resolveExportArchiveFile } from '../export/exportArchiveFiles';
import { startLangpackExport } from '../services/startLangpackExport';

export const exportArchivesRoutes = async (app: FastifyInstance, db: Tx) => {
  app.post<{
    Body: { modIds?: number[]; srcLang?: string; targetLang?: string };
  }>('/api/exports/langpack', async (req, reply) => {
    const result = await startLangpackExport(db, {
      modIds: req.body?.modIds ?? [],
      srcLang: req.body?.srcLang,
      targetLang: req.body?.targetLang,
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    log.info(`POST /api/exports/langpack archive=${result.archive.id} job=${result.jobId}`);
    return reply.send({ ok: true, archive: result.archive, jobId: result.jobId });
  });

  app.get<{ Querystring: { game?: string } }>('/api/exports', async (req, reply) => {
    const archives = await listExportArchives(db, req.query.game);
    return reply.send({ archives });
  });

  app.get<{ Params: { id: string } }>('/api/exports/:id/file', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid id' });
    const archive = await getExportArchive(db, id);
    if (!archive) return reply.code(404).send({ error: 'Not found' });
    if (archive.status !== 'completed' || !archive.rel_path) {
      return reply.code(409).send({ error: 'Archive is not ready to download' });
    }
    const filePath = resolveExportArchiveFile(archive.rel_path);
    if (!filePath || !fs.existsSync(filePath)) {
      return reply.code(404).send({ error: 'Archive file is missing' });
    }
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${archive.file_name}"`)
      .send(fs.createReadStream(filePath));
  });

  app.delete<{ Params: { id: string } }>('/api/exports/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: 'Invalid id' });
    const archive = await getExportArchive(db, id);
    if (!archive) return reply.code(404).send({ error: 'Not found' });
    if (archive.status === 'running' && archive.job_id) {
      await requestJobStop(archive.job_id);
    }
    removeExportArchiveFiles(archive.id);
    await deleteExportArchiveRow(db, archive.id);
    log.info(`DELETE /api/exports/${id}`);
    return reply.send({ ok: true });
  });
};

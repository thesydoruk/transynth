import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../../db';
import { applyImportedModStringsAsTranslations } from '../../data/queries';
import { log } from '../../../logger';
import { CONFIG } from '../../../config';
import {
  findActiveJobIdForMod,
  readJobStatus,
  stopJobOfKind,
} from '../../../../worker/src/api/jobStatus';
import { startJobSse } from '../../../../worker/src/api/startJobSse';

export const registerApplyImportedRoutes = async (app: FastifyInstance, db: Tx) => {
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

    const running = await findActiveJobIdForMod(['apply-imported'], targetModId);
    if (running) {
      return reply
        .code(409)
        .send({ error: `Apply-imported already running (job #${running.jobId})` });
    }

    await startJobSse(req, reply, {
      data: {
        kind: 'apply-imported',
        modId: targetModId,
        params: { fromModId, importedLang, srcLang, targetLang },
      },
      initialSnapshotData: {
        targetModId,
        fromModId,
        importedLang,
        stats: { applied: 0, skipped: 0, unmatched: 0, empty: 0 },
      },
    });
  });

  app.post<{ Params: { jobId: string } }>('/api/apply-imported/:jobId/stop', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    if (!(await stopJobOfKind(jobId, ['apply-imported']))) {
      return reply.code(404).send({ error: 'Running apply-imported job not found' });
    }
    return reply.send({ ok: true });
  });

  app.get<{ Params: { jobId: string } }>('/api/apply-imported/:jobId', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    const job = await readJobStatus(jobId, ['apply-imported']);
    if (!job) return reply.code(404).send({ error: 'Apply-imported job not found' });
    return reply.send(job);
  });
};

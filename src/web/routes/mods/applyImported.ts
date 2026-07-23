import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../../db';
import { applyImportedModStringsAsTranslations } from '../../data/queries';
import {
  findRunningApplyImportedJob,
  getApplyImportedJob,
  requestApplyImportedStop,
  runApplyImportedJob,
  scheduleApplyImportedJobCleanup,
} from '../../import/applyImportedJobService';
import { log } from '../../../logger';
import { CONFIG } from '../../../config';

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
};

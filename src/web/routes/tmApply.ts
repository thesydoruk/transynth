import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import { log } from '../../logger';
import { findRunningModTranslateJob } from '../services/modTranslateGuard';
import {
  getTmApplyJob,
  requestTmApplyStop,
  requestTmApplyStopByModId,
  runTmApplyJob,
  scheduleTmApplyJobCleanup,
} from '../services/tmApplyJobService';

export const tmApplyRoutes = async (app: FastifyInstance, db: Tx) => {
  app.post<{
    Params: { modId: string };
    Body: { srcLang?: string; targetLang?: string };
  }>('/api/mods/:modId/tm-apply', async (req, reply) => {
    const modId = Number(req.params.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid modId' });
    }

    const srcLang = req.body?.srcLang?.trim() || CONFIG.defaultSrcLang;
    const targetLang = req.body?.targetLang?.trim() || CONFIG.defaultTgtLang;

    const running = findRunningModTranslateJob(modId);
    if (running != null) {
      const label = running.mode === 'tm' ? 'TM apply' : 'Translation';
      return reply.code(409).send({ error: `${label} already running (job #${running.jobId})` });
    }

    const { rows: modRows } = await db.query<{ name: string }>(
      `SELECT name FROM mods WHERE id = $1`,
      [modId],
    );
    if (!modRows[0]) return reply.code(404).send({ error: 'Mod not found' });

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
        /* client disconnected */
      }
    };

    let finishedJobId: number | null = null;

    void (async () => {
      try {
        const snapshot = await runTmApplyJob(db, { modId, srcLang, targetLang }, send);
        finishedJobId = snapshot.jobId;
      } catch (err: unknown) {
        log.error(
          `[TM apply mod #${modId}] Stream error: ${err instanceof Error ? err.message : String(err)}`,
        );
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      } finally {
        if (finishedJobId != null) scheduleTmApplyJobCleanup(finishedJobId);
        try {
          reply.raw.end();
        } catch {
          /* already closed */
        }
      }
    })();
  });

  app.post<{ Params: { jobId: string } }>('/api/tm-apply/:jobId/stop', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    if (!requestTmApplyStop(jobId)) {
      return reply.code(404).send({ error: 'Running TM apply job not found' });
    }
    return reply.send({ ok: true });
  });

  app.post<{ Params: { modId: string } }>('/api/mods/:modId/tm-apply/stop', async (req, reply) => {
    const modId = Number(req.params.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid modId' });
    }
    if (!requestTmApplyStopByModId(modId)) {
      return reply.code(404).send({ error: 'Running TM apply job not found' });
    }
    return reply.send({ ok: true });
  });

  app.get<{ Params: { jobId: string } }>('/api/tm-apply/:jobId', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    const job = getTmApplyJob(jobId);
    if (!job) return reply.code(404).send({ error: 'TM apply job not found' });
    return reply.send(job);
  });
};

import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import { log } from '../../logger';
import {
  findRunningModVoiceGenerateJob,
  getModVoiceGenerateJob,
  requestModVoiceGenerateStop,
  requestModVoiceGenerateStopByModId,
  runModVoiceGenerateJob,
  scheduleModVoiceGenerateJobCleanup,
} from '../voice/modVoiceGenerateService';

export const modVoiceGenerateRoutes = async (app: FastifyInstance, db: Tx) => {
  // POST /api/mods/:modId/voice-generate — synthesize localized voice (SSE progress stream)
  app.post<{
    Params: { modId: string };
    Body: { srcLang?: string; targetLang?: string };
  }>('/api/mods/:modId/voice-generate', async (req, reply) => {
    const modId = Number(req.params.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid modId' });
    }

    const srcLang = req.body?.srcLang?.trim() || CONFIG.defaultSrcLang;
    const targetLang = req.body?.targetLang?.trim() || CONFIG.defaultTgtLang;

    const runningJobId = findRunningModVoiceGenerateJob(modId);
    if (runningJobId != null) {
      return reply
        .code(409)
        .send({ error: `Voice generation already running (job #${runningJobId})` });
    }

    const { rows: modRows } = await db.query<{ name: string; game: string }>(
      `SELECT name, game FROM mods WHERE id = $1`,
      [modId],
    );
    const mod = modRows[0];
    if (!mod) return reply.code(404).send({ error: 'Mod not found' });

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
        const snapshot = await runModVoiceGenerateJob(
          db,
          {
            modId,
            srcLang,
            targetLang,
            game: mod.game,
            modName: mod.name,
          },
          send,
        );
        finishedJobId = snapshot.jobId;
      } catch (err: unknown) {
        log.error(
          `[Voice generate mod #${modId}] Stream error: ${err instanceof Error ? err.message : String(err)}`,
        );
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      } finally {
        if (finishedJobId != null) scheduleModVoiceGenerateJobCleanup(finishedJobId);
        try {
          reply.raw.end();
        } catch {
          /* already closed */
        }
      }
    })();
  });

  app.post<{ Params: { jobId: string } }>('/api/voice-generate/:jobId/stop', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    if (!requestModVoiceGenerateStop(jobId)) {
      return reply.code(404).send({ error: 'Running voice generation job not found' });
    }
    return reply.send({ ok: true });
  });

  app.post<{ Params: { modId: string } }>(
    '/api/mods/:modId/voice-generate/stop',
    async (req, reply) => {
      const modId = Number(req.params.modId);
      if (!Number.isInteger(modId) || modId < 1) {
        return reply.code(400).send({ error: 'Invalid modId' });
      }
      if (!requestModVoiceGenerateStopByModId(modId)) {
        return reply.code(404).send({ error: 'Running voice generation job not found' });
      }
      return reply.send({ ok: true });
    },
  );

  app.get<{ Params: { jobId: string } }>('/api/voice-generate/:jobId', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    const job = getModVoiceGenerateJob(jobId);
    if (!job) return reply.code(404).send({ error: 'Voice generation job not found' });
    return reply.send(job);
  });
};

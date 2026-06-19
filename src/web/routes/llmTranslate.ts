import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import { log } from '../../logger';
import {
  findRunningLlmTranslateJob,
  getLlmTranslateJob,
  requestLlmTranslateStop,
  runLlmTranslateJob,
  scheduleLlmTranslateJobCleanup,
} from '../llmTranslateService';

export const llmTranslateRoutes = async (app: FastifyInstance, db: Tx) => {
  // POST /api/mods/:modId/llm-translate — start mod-wide translation (SSE progress stream)
  app.post<{
    Params: { modId: string };
    Body: { srcLang?: string; targetLang?: string };
  }>('/api/mods/:modId/llm-translate', async (req, reply) => {
    const modId = Number(req.params.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid modId' });
    }

    const srcLang = req.body?.srcLang?.trim() || CONFIG.defaultSrcLang;
    const targetLang = req.body?.targetLang?.trim() || CONFIG.defaultTgtLang;

    const runningJobId = findRunningLlmTranslateJob(modId);
    if (runningJobId != null) {
      return reply.code(409).send({ error: `Translation already running (job #${runningJobId})` });
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
        const snapshot = await runLlmTranslateJob(
          db,
          {
            modId,
            srcLang,
            targetLang,
            modName: mod.name,
            game: mod.game,
          },
          send,
        );
        finishedJobId = snapshot.jobId;
      } catch (err: unknown) {
        log.error(
          `[LLM Translate mod #${modId}] Stream error: ${err instanceof Error ? err.message : String(err)}`,
        );
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      } finally {
        if (finishedJobId != null) scheduleLlmTranslateJobCleanup(finishedJobId);
        try {
          reply.raw.end();
        } catch {
          /* already closed */
        }
      }
    })();
  });

  app.post<{ Params: { jobId: string } }>('/api/llm-translate/:jobId/stop', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    if (!requestLlmTranslateStop(jobId)) {
      return reply.code(404).send({ error: 'Running translation job not found' });
    }
    return reply.send({ ok: true });
  });

  app.get<{ Params: { jobId: string } }>('/api/llm-translate/:jobId', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    const job = getLlmTranslateJob(jobId);
    if (!job) return reply.code(404).send({ error: 'Translation job not found' });
    return reply.send(job);
  });
};

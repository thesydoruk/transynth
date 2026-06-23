import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import { log } from '../../logger';
import {
  findRunningLlmVerifyJob,
  getLlmVerifyJob,
  requestLlmVerifyStop,
  requestLlmVerifyStopByModId,
  runLlmVerifyJob,
  scheduleLlmVerifyJobCleanup,
} from '../llmVerifyService';

export const llmVerifyRoutes = async (app: FastifyInstance, db: Tx) => {
  // POST /api/mods/:modId/llm-verify — start verification (SSE progress stream)
  app.post<{
    Params: { modId: string };
    Body: { srcLang?: string; targetLang?: string; autoApproveVerified?: boolean };
  }>('/api/mods/:modId/llm-verify', async (req, reply) => {
    const modId = Number(req.params.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid modId' });
    }

    const srcLang = req.body?.srcLang?.trim() || CONFIG.defaultSrcLang;
    const targetLang = req.body?.targetLang?.trim() || CONFIG.defaultTgtLang;
    const autoApproveVerified = req.body?.autoApproveVerified === true;

    const runningJobId = findRunningLlmVerifyJob(modId);
    if (runningJobId != null) {
      return reply.code(409).send({ error: `Verification already running (job #${runningJobId})` });
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
        const snapshot = await runLlmVerifyJob(
          db,
          {
            modId,
            srcLang,
            targetLang,
            modName: mod.name,
            game: mod.game,
            autoApproveVerified,
          },
          send,
        );
        finishedJobId = snapshot.jobId;
      } catch (err: unknown) {
        log.error(
          `[LLM Verify mod #${modId}] Stream error: ${err instanceof Error ? err.message : String(err)}`,
        );
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      } finally {
        if (finishedJobId != null) scheduleLlmVerifyJobCleanup(finishedJobId);
        try {
          reply.raw.end();
        } catch {
          /* already closed */
        }
      }
    })();
  });

  // POST /api/llm-verify/:jobId/stop — request cancellation
  app.post<{ Params: { jobId: string } }>('/api/llm-verify/:jobId/stop', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    if (!requestLlmVerifyStop(jobId)) {
      return reply.code(404).send({ error: 'Running verification job not found' });
    }
    return reply.send({ ok: true });
  });

  // POST /api/mods/:modId/llm-verify/stop — cancel by mod (when jobId not yet known client-side)
  app.post<{ Params: { modId: string } }>(
    '/api/mods/:modId/llm-verify/stop',
    async (req, reply) => {
      const modId = Number(req.params.modId);
      if (!Number.isInteger(modId) || modId < 1) {
        return reply.code(400).send({ error: 'Invalid modId' });
      }
      if (!requestLlmVerifyStopByModId(modId)) {
        return reply.code(404).send({ error: 'Running verification job not found' });
      }
      return reply.send({ ok: true });
    },
  );

  // GET /api/llm-verify/:jobId — current in-memory job snapshot (for reopening modal)
  app.get<{ Params: { jobId: string } }>('/api/llm-verify/:jobId', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    const job = getLlmVerifyJob(jobId);
    if (!job) return reply.code(404).send({ error: 'Verification job not found' });
    return reply.send(job);
  });
};

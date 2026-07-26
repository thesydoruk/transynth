import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import { log } from '../../logger';
import {
  findRunningLlmGenderDetectJob,
  getLlmGenderDetectJob,
  requestLlmGenderDetectStop,
  requestLlmGenderDetectStopByModId,
  runLlmGenderDetectJob,
  scheduleLlmGenderDetectJobCleanup,
} from '../llm/genderDetectService';

export const llmGenderDetectRoutes = async (app: FastifyInstance, db: Tx) => {
  app.post<{
    Params: { modId: string };
    Body: { srcLang?: string; useLlm?: boolean; force?: boolean };
  }>('/api/mods/:modId/llm-gender-detect', async (req, reply) => {
    const modId = Number(req.params.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid modId' });
    }

    const srcLang = req.body?.srcLang?.trim() || CONFIG.defaultSrcLang;
    const useLlm = req.body?.useLlm !== false;
    const force = req.body?.force === true;

    const runningJobId = findRunningLlmGenderDetectJob(modId);
    if (runningJobId != null) {
      return reply
        .code(409)
        .send({ error: `Gender-detect already running (job #${runningJobId})` });
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
        if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        /* disconnected */
      }
    };

    let finishedJobId: number | null = null;

    void (async () => {
      try {
        const snapshot = await runLlmGenderDetectJob(
          db,
          { modId, srcLang, modName: mod.name, game: mod.game, useLlm, force },
          send,
        );
        finishedJobId = snapshot.jobId;
      } catch (err: unknown) {
        log.error(
          `[LLM Gender-detect mod #${modId}] Stream error: ${err instanceof Error ? err.message : String(err)}`,
        );
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      } finally {
        if (finishedJobId != null) scheduleLlmGenderDetectJobCleanup(finishedJobId);
        try {
          reply.raw.end();
        } catch {
          /* closed */
        }
      }
    })();
  });

  app.post<{ Params: { jobId: string } }>(
    '/api/llm-gender-detect/:jobId/stop',
    async (req, reply) => {
      const jobId = Number(req.params.jobId);
      if (!Number.isInteger(jobId) || jobId < 1) {
        return reply.code(400).send({ error: 'Invalid jobId' });
      }
      if (!requestLlmGenderDetectStop(jobId)) {
        return reply.code(404).send({ error: 'Running gender-detect job not found' });
      }
      return reply.send({ ok: true });
    },
  );

  app.post<{ Params: { modId: string } }>(
    '/api/mods/:modId/llm-gender-detect/stop',
    async (req, reply) => {
      const modId = Number(req.params.modId);
      if (!Number.isInteger(modId) || modId < 1) {
        return reply.code(400).send({ error: 'Invalid modId' });
      }
      if (!requestLlmGenderDetectStopByModId(modId)) {
        return reply.code(404).send({ error: 'Running gender-detect job not found' });
      }
      return reply.send({ ok: true });
    },
  );

  app.get<{ Params: { jobId: string } }>('/api/llm-gender-detect/:jobId', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    const job = getLlmGenderDetectJob(jobId);
    if (!job) return reply.code(404).send({ error: 'Gender-detect job not found' });
    return reply.send(job);
  });
};

import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import {
  findActiveJobIdForMod,
  readJobStatus,
  stopJobForMod,
  stopJobOfKind,
} from '../../../worker/src/api/jobStatus';
import { startJobSse } from '../../../worker/src/api/startJobSse';

export const llmVerifyRoutes = async (app: FastifyInstance, db: Tx) => {
  // POST /api/mods/:modId/llm-verify — start verification (SSE progress stream)
  app.post<{
    Params: { modId: string };
    Body: {
      srcLang?: string;
      targetLang?: string;
      autoApproveVerified?: boolean;
      fixSuspicious?: boolean;
      includeConfirmed?: boolean;
    };
  }>('/api/mods/:modId/llm-verify', async (req, reply) => {
    const modId = Number(req.params.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid modId' });
    }

    const srcLang = req.body?.srcLang?.trim() || CONFIG.defaultSrcLang;
    const targetLang = req.body?.targetLang?.trim() || CONFIG.defaultTgtLang;
    const autoApproveVerified = req.body?.autoApproveVerified === true;
    const fixSuspicious = req.body?.fixSuspicious === true;
    const includeConfirmed = req.body?.includeConfirmed === true;

    const running = await findActiveJobIdForMod(['llm-verify'], modId);
    if (running) {
      return reply
        .code(409)
        .send({ error: `Verification already running (job #${running.jobId})` });
    }

    const { rows: modRows } = await db.query<{ name: string; game: string }>(
      `SELECT name, game FROM mods WHERE id = $1`,
      [modId],
    );
    const mod = modRows[0];
    if (!mod) return reply.code(404).send({ error: 'Mod not found' });

    await startJobSse(req, reply, {
      data: {
        kind: 'llm-verify',
        modId,
        params: {
          srcLang,
          targetLang,
          modName: mod.name,
          game: mod.game,
          autoApproveVerified,
          fixSuspicious,
          includeConfirmed,
        },
      },
      initialSnapshotData: { approved: 0, fixed: 0, issues: [], actionLog: [] },
    });
  });

  // POST /api/llm-verify/:jobId/stop — request cancellation
  app.post<{ Params: { jobId: string } }>('/api/llm-verify/:jobId/stop', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    if (!(await stopJobOfKind(jobId, ['llm-verify']))) {
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
      if (!(await stopJobForMod(['llm-verify'], modId))) {
        return reply.code(404).send({ error: 'Running verification job not found' });
      }
      return reply.send({ ok: true });
    },
  );

  // GET /api/llm-verify/:jobId — current job snapshot (for reopening modal)
  app.get<{ Params: { jobId: string } }>('/api/llm-verify/:jobId', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    const job = await readJobStatus(jobId, ['llm-verify']);
    if (!job) return reply.code(404).send({ error: 'Verification job not found' });
    return reply.send(job);
  });
};

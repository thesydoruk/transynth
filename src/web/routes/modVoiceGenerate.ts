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

export const modVoiceGenerateRoutes = async (app: FastifyInstance, db: Tx) => {
  // POST /api/mods/:modId/voice-generate — synthesize localized voice (SSE progress stream)
  app.post<{
    Params: { modId: string };
    Body: { srcLang?: string; targetLang?: string; scope?: 'all' | 'missing' };
  }>('/api/mods/:modId/voice-generate', async (req, reply) => {
    const modId = Number(req.params.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid modId' });
    }

    const srcLang = req.body?.srcLang?.trim() || CONFIG.defaultSrcLang;
    const targetLang = req.body?.targetLang?.trim() || CONFIG.defaultTgtLang;
    const scope = req.body?.scope === 'all' ? 'all' : 'missing';

    const running = await findActiveJobIdForMod(['voice-generate'], modId);
    if (running) {
      return reply
        .code(409)
        .send({ error: `Voice generation already running (job #${running.jobId})` });
    }

    const { rows: modRows } = await db.query<{ name: string; game: string }>(
      `SELECT name, game FROM mods WHERE id = $1`,
      [modId],
    );
    const mod = modRows[0];
    if (!mod) return reply.code(404).send({ error: 'Mod not found' });

    await startJobSse(req, reply, {
      data: {
        kind: 'voice-generate',
        modId,
        params: { srcLang, targetLang, game: mod.game, modName: mod.name, scope },
      },
      initialSnapshotData: { written: 0, skipped: 0, warningCount: 0 },
    });
  });

  app.post<{ Params: { jobId: string } }>('/api/voice-generate/:jobId/stop', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    if (!(await stopJobOfKind(jobId, ['voice-generate']))) {
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
      if (!(await stopJobForMod(['voice-generate'], modId))) {
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
    const job = await readJobStatus(jobId, ['voice-generate']);
    if (!job) return reply.code(404).send({ error: 'Voice generation job not found' });
    return reply.send(job);
  });
};

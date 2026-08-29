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

    const running = await findActiveJobIdForMod(['gender-detect'], modId);
    if (running) {
      return reply
        .code(409)
        .send({ error: `Gender-detect already running (job #${running.jobId})` });
    }

    const { rows: modRows } = await db.query<{ name: string; game: string }>(
      `SELECT name, game FROM mods WHERE id = $1`,
      [modId],
    );
    const mod = modRows[0];
    if (!mod) return reply.code(404).send({ error: 'Mod not found' });

    await startJobSse(req, reply, {
      data: {
        kind: 'gender-detect',
        modId,
        params: { srcLang, modName: mod.name, game: mod.game, useLlm, force },
      },
      initialSnapshotData: { resolvedCount: 0 },
    });
  });

  app.post<{ Params: { jobId: string } }>(
    '/api/llm-gender-detect/:jobId/stop',
    async (req, reply) => {
      const jobId = Number(req.params.jobId);
      if (!Number.isInteger(jobId) || jobId < 1) {
        return reply.code(400).send({ error: 'Invalid jobId' });
      }
      if (!(await stopJobOfKind(jobId, ['gender-detect']))) {
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
      if (!(await stopJobForMod(['gender-detect'], modId))) {
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
    const job = await readJobStatus(jobId, ['gender-detect']);
    if (!job) return reply.code(404).send({ error: 'Gender-detect job not found' });
    return reply.send(job);
  });
};

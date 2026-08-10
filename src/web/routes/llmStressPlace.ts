import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import type { ModStressPlaceScope } from '../data/queries/stressPlacement';
import {
  findActiveJobIdForMod,
  readJobStatus,
  stopJobForMod,
  stopJobOfKind,
} from '../../../worker/src/api/jobStatus';
import { startJobSse } from '../../../worker/src/api/startJobSse';

export const llmStressPlaceRoutes = async (app: FastifyInstance, db: Tx) => {
  app.post<{
    Params: { modId: string };
    Body: {
      srcLang?: string;
      targetLang?: string;
      scope?: ModStressPlaceScope;
      speakerKey?: string;
      force?: boolean;
    };
  }>('/api/mods/:modId/llm-stress-place', async (req, reply) => {
    const modId = Number(req.params.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid modId' });
    }

    const srcLang = req.body?.srcLang?.trim() || CONFIG.defaultSrcLang;
    const targetLang = req.body?.targetLang?.trim() || CONFIG.defaultTgtLang;
    const scope = req.body?.scope === 'all' ? 'all' : 'missing';
    const speakerKey = req.body?.speakerKey?.trim() || undefined;
    const force = req.body?.force === true;

    const running = await findActiveJobIdForMod(['stress-place'], modId);
    if (running) {
      return reply
        .code(409)
        .send({ error: `Stress placement already running (job #${running.jobId})` });
    }

    const { rows: modRows } = await db.query<{ name: string }>(
      `SELECT name FROM mods WHERE id = $1`,
      [modId],
    );
    if (!modRows[0]) return reply.code(404).send({ error: 'Mod not found' });

    await startJobSse(req, reply, {
      data: {
        kind: 'stress-place',
        modId,
        params: { srcLang, targetLang, scope, ...(speakerKey ? { speakerKey } : {}), force },
      },
      initialSnapshotData: { placedCount: 0 },
    });
  });

  app.post<{ Params: { jobId: string } }>(
    '/api/llm-stress-place/:jobId/stop',
    async (req, reply) => {
      const jobId = Number(req.params.jobId);
      if (!Number.isInteger(jobId) || jobId < 1) {
        return reply.code(400).send({ error: 'Invalid jobId' });
      }
      if (!(await stopJobOfKind(jobId, ['stress-place']))) {
        return reply.code(404).send({ error: 'Running stress placement job not found' });
      }
      return reply.send({ ok: true });
    },
  );

  app.post<{ Params: { modId: string } }>(
    '/api/mods/:modId/llm-stress-place/stop',
    async (req, reply) => {
      const modId = Number(req.params.modId);
      if (!Number.isInteger(modId) || modId < 1) {
        return reply.code(400).send({ error: 'Invalid modId' });
      }
      if (!(await stopJobForMod(['stress-place'], modId))) {
        return reply.code(404).send({ error: 'Running stress placement job not found' });
      }
      return reply.send({ ok: true });
    },
  );

  app.get<{ Params: { jobId: string } }>('/api/llm-stress-place/:jobId', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    const job = await readJobStatus(jobId, ['stress-place']);
    if (!job) return reply.code(404).send({ error: 'Stress placement job not found' });
    return reply.send(job);
  });
};

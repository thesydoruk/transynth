import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import type { JobKind } from '../../../worker/src/types';
import {
  findActiveJobIdForMod,
  readJobStatus,
  stopJobForMod,
  stopJobOfKind,
} from '../../../worker/src/api/jobStatus';
import { startJobSse } from '../../../worker/src/api/startJobSse';

/** A mod may run either TM apply or LLM translate, never both at once. */
const TRANSLATE_GUARD_KINDS: readonly JobKind[] = ['llm-translate', 'tm-apply'];

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

    const running = await findActiveJobIdForMod(TRANSLATE_GUARD_KINDS, modId);
    if (running) {
      const label = running.kind === 'tm-apply' ? 'TM apply' : 'Translation';
      return reply.code(409).send({ error: `${label} already running (job #${running.jobId})` });
    }

    const { rows: modRows } = await db.query<{ name: string }>(
      `SELECT name FROM mods WHERE id = $1`,
      [modId],
    );
    if (!modRows[0]) return reply.code(404).send({ error: 'Mod not found' });

    await startJobSse(req, reply, {
      data: { kind: 'tm-apply', modId, params: { srcLang, targetLang } },
      initialSnapshotData: { applied: 0, skipped: 0 },
    });
  });

  app.post<{ Params: { jobId: string } }>('/api/tm-apply/:jobId/stop', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    if (!(await stopJobOfKind(jobId, ['tm-apply']))) {
      return reply.code(404).send({ error: 'Running TM apply job not found' });
    }
    return reply.send({ ok: true });
  });

  app.post<{ Params: { modId: string } }>('/api/mods/:modId/tm-apply/stop', async (req, reply) => {
    const modId = Number(req.params.modId);
    if (!Number.isInteger(modId) || modId < 1) {
      return reply.code(400).send({ error: 'Invalid modId' });
    }
    if (!(await stopJobForMod(['tm-apply'], modId))) {
      return reply.code(404).send({ error: 'Running TM apply job not found' });
    }
    return reply.send({ ok: true });
  });

  app.get<{ Params: { jobId: string } }>('/api/tm-apply/:jobId', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    const job = await readJobStatus(jobId, ['tm-apply']);
    if (!job) return reply.code(404).send({ error: 'TM apply job not found' });
    return reply.send(job);
  });
};

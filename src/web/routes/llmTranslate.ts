import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import type { JobKind } from '../../../worker/src/types';
import {
  findActiveJobIdForMod,
  readJobStatus,
  stopJobOfKind,
} from '../../../worker/src/api/jobStatus';
import { startJobSse } from '../../../worker/src/api/startJobSse';

/** A mod may run either TM apply or LLM translate, never both at once. */
const TRANSLATE_GUARD_KINDS: readonly JobKind[] = ['llm-translate', 'tm-apply'];

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

    const running = await findActiveJobIdForMod(TRANSLATE_GUARD_KINDS, modId);
    if (running) {
      const label = running.kind === 'tm-apply' ? 'TM apply' : 'Translation';
      return reply.code(409).send({ error: `${label} already running (job #${running.jobId})` });
    }

    const { rows: modRows } = await db.query<{ name: string; game: string }>(
      `SELECT name, game FROM mods WHERE id = $1`,
      [modId],
    );
    const mod = modRows[0];
    if (!mod) return reply.code(404).send({ error: 'Mod not found' });

    await startJobSse(req, reply, {
      data: {
        kind: 'llm-translate',
        modId,
        params: { srcLang, targetLang, modName: mod.name, game: mod.game },
      },
      initialSnapshotData: { rows: [] },
    });
  });

  app.post<{ Params: { jobId: string } }>('/api/llm-translate/:jobId/stop', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    if (!(await stopJobOfKind(jobId, ['llm-translate']))) {
      return reply.code(404).send({ error: 'Running translation job not found' });
    }
    return reply.send({ ok: true });
  });

  app.get<{ Params: { jobId: string } }>('/api/llm-translate/:jobId', async (req, reply) => {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) {
      return reply.code(400).send({ error: 'Invalid jobId' });
    }
    const job = await readJobStatus(jobId, ['llm-translate']);
    if (!job) return reply.code(404).send({ error: 'Translation job not found' });
    return reply.send(job);
  });
};

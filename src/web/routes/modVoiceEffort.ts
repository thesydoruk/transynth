/**
 * Vocal effort analysis of a mod's original takes, as a background job, and
 * the per-game numbers Settings → Voice shows next to the effort-tags switch.
 *
 *   POST /api/mods/:modId/voice-effort         start (SSE, job `voice-effort`)
 *   POST /api/mods/:modId/voice-effort/stop    stop the mod's analysis
 *   POST /api/voice-effort/:jobId/stop         stop one job
 *   GET  /api/voice-effort/:jobId              status + result
 *   GET  /api/games/:gameId/voice-effort-summary
 */
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { findGamePlugin } from '../../games/registry';
import { loadVoiceEffortGameSummary } from '../../voice/voiceEffortSummary';
import {
  findActiveJobIdForMod,
  readJobStatus,
  stopJobForMod,
  stopJobOfKind,
} from '../../../worker/src/api/jobStatus';
import { startJobSse } from '../../../worker/src/api/startJobSse';

const KIND = ['voice-effort'] as const;

/** Only a game whose plugin reads line directions has the calm baseline the analysis needs. */
export const gameAnalyzesVocalEffort = (game: string): boolean =>
  findGamePlugin(game)?.voice?.loadLineDirections != null;

const parseId = (raw: string): number | null => {
  const id = Number(raw);
  return Number.isInteger(id) && id >= 1 ? id : null;
};

export const modVoiceEffortRoutes = async (app: FastifyInstance, db: Tx) => {
  app.post<{ Params: { modId: string } }>('/api/mods/:modId/voice-effort', async (req, reply) => {
    const modId = parseId(req.params.modId);
    if (modId == null) return reply.code(400).send({ error: 'Invalid modId' });

    const { rows } = await db.query<{ name: string; game: string }>(
      `SELECT name, game FROM mods WHERE id = $1`,
      [modId],
    );
    const mod = rows[0];
    if (!mod) return reply.code(404).send({ error: 'Mod not found' });
    if (!gameAnalyzesVocalEffort(mod.game)) {
      return reply
        .code(400)
        .send({ error: 'This game records nothing about how its lines are delivered' });
    }

    // One analysis per mod. Synthesis reads the tags when it starts, so an analysis
    // that rewrote them mid-job would leave that job's new takes stale at once.
    const running = await findActiveJobIdForMod([...KIND, 'voice-generate'], modId);
    if (running) {
      const what = running.kind === 'voice-effort' ? 'Vocal effort analysis' : 'Voice generation';
      return reply.code(409).send({ error: `${what} already running (job #${running.jobId})` });
    }

    await startJobSse(req, reply, {
      data: { kind: 'voice-effort', modId, params: { game: mod.game, modName: mod.name } },
      initialSnapshotData: { result: null },
    });
  });

  app.post<{ Params: { modId: string } }>(
    '/api/mods/:modId/voice-effort/stop',
    async (req, reply) => {
      const modId = parseId(req.params.modId);
      if (modId == null) return reply.code(400).send({ error: 'Invalid modId' });
      if (!(await stopJobForMod(KIND, modId))) {
        return reply.code(404).send({ error: 'Running vocal effort analysis not found' });
      }
      return reply.send({ ok: true });
    },
  );

  app.post<{ Params: { jobId: string } }>('/api/voice-effort/:jobId/stop', async (req, reply) => {
    const jobId = parseId(req.params.jobId);
    if (jobId == null) return reply.code(400).send({ error: 'Invalid jobId' });
    if (!(await stopJobOfKind(jobId, KIND))) {
      return reply.code(404).send({ error: 'Running vocal effort analysis not found' });
    }
    return reply.send({ ok: true });
  });

  app.get<{ Params: { jobId: string } }>('/api/voice-effort/:jobId', async (req, reply) => {
    const jobId = parseId(req.params.jobId);
    if (jobId == null) return reply.code(400).send({ error: 'Invalid jobId' });
    const job = await readJobStatus(jobId, KIND);
    if (!job) return reply.code(404).send({ error: 'Vocal effort analysis not found' });
    return reply.send(job);
  });

  app.get<{ Params: { gameId: string } }>(
    '/api/games/:gameId/voice-effort-summary',
    async (req, reply) => {
      const { gameId } = req.params;
      if (!findGamePlugin(gameId)) return reply.code(404).send({ error: 'Unknown game' });
      return reply.send(await loadVoiceEffortGameSummary(db, gameId));
    },
  );
};

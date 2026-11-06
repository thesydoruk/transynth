/**
 * The resident Vortex agent's routes and the group state the Vortex page reads.
 *
 *   POST /api/vortex/agent/heartbeat        — agent state (token); returns the group id,
 *                                             the newest langpack to deliver and the videos
 *                                             whose dub is waiting to be written
 *   POST /api/vortex/groups/:id/export-order — the group's current load order (token)
 *   GET  /api/vortex/groups/:id/state        — group, agent, current run, langpack,
 *                                             which service kinds have a healthy host
 *   GET  /api/vortex/groups/:id/runs         — run history
 */
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { log } from '../../logger';
import { allGamePlugins } from '../../games/registry';
import { probeKindsHealthy } from '../../services/kindHealth';
import type { GameId } from '../../types';
import { getVortexGroup, getOrCreateVortexGroup } from '../../vortex/db';
import {
  getLatestGroupLangpack,
  getVortexAgentForGroup,
  setGroupExportOrder,
  upsertVortexAgent,
} from '../../vortex/dbAgents';
import { findActiveVortexRun, listVortexSyncRuns } from '../../vortex/dbRuns';
import { isVortexExportOrder } from '../../vortex/exportOrder';
import { vortexGroupKey, vortexGroupLabel } from '../../vortex/groupKey';
import { ensureVortexSchema } from '../../vortex/schema';
import { listVideoPackTasks } from '../../video/db';
import { ensureVideoSchema } from '../../video/schema';
import type { VortexAgentHeartbeat, VortexAgentState, VortexExportOrder } from '../../vortex/types';
import { parseRouteId } from './parseRouteId';

const AGENT_STATES: readonly VortexAgentState[] = [
  'idle',
  'scanning',
  'uploading',
  'waiting-server',
  'delivering',
  'settling',
  'error',
];

/** Service kinds the Vortex page shows a light for: LLM stages, embeddings, voice. */
const STATE_SERVICE_KINDS = ['llm', 'embed', 'tts'] as const;

const isDeployableGame = (value: unknown): value is GameId =>
  typeof value === 'string' && allGamePlugins().some((p) => p.id === value && p.deployment);

/** The heartbeat body, or the reason it is not one. */
export const parseHeartbeat = (
  body: unknown,
): { ok: true; beat: VortexAgentHeartbeat } | { ok: false; error: string } => {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isDeployableGame(b.game)) return { ok: false, error: 'game must be a deployable game' };
  for (const key of ['stagingPath', 'gameDir', 'agentKey'] as const) {
    if (typeof b[key] !== 'string' || !b[key]) return { ok: false, error: `${key} is required` };
  }
  if (!AGENT_STATES.includes(b.state as VortexAgentState)) {
    return { ok: false, error: `state must be one of ${AGENT_STATES.join(', ')}` };
  }
  const stagingPath = b.stagingPath as string;
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const pending = b.pending as Record<string, unknown> | null | undefined;
  const delivered = b.delivered as Record<string, unknown> | null | undefined;
  return {
    ok: true,
    beat: {
      game: b.game,
      groupKey: str(b.groupKey) || vortexGroupKey(b.game, stagingPath),
      label: str(b.label) || vortexGroupLabel(stagingPath, b.game),
      stagingPath,
      gameDir: b.gameDir as string,
      agentKey: b.agentKey as string,
      agentVersion: str(b.agentVersion),
      state: b.state as VortexAgentState,
      pollSec: num(b.pollSec) ?? 30,
      pending: pending
        ? {
            units: num(pending.units) ?? 0,
            orderChanged: pending.orderChanged === true,
            settleUntil: str(pending.settleUntil),
          }
        : null,
      lastSyncAt: str(b.lastSyncAt),
      lastRunId: num(b.lastRunId),
      lastError: str(b.lastError),
      delivered:
        delivered && num(delivered.archiveId) != null
          ? {
              archiveId: num(delivered.archiveId)!,
              fileName: str(delivered.fileName) ?? '',
              at: str(delivered.at) ?? new Date().toISOString(),
            }
          : null,
    },
  };
};

const gameHasMedia = (game: GameId): boolean =>
  allGamePlugins().some((p) => p.id === game && p.media);

export const vortexAgentRoutes = async (app: FastifyInstance, db: Tx) => {
  await ensureVortexSchema(db);
  await ensureVideoSchema(db);

  app.post('/api/vortex/agent/heartbeat', async (req, reply) => {
    const parsed = parseHeartbeat(req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const { beat } = parsed;
    const group = await getOrCreateVortexGroup(db, {
      game: beat.game,
      groupKey: beat.groupKey,
      label: beat.label,
      stagingPath: beat.stagingPath,
      gameDir: beat.gameDir,
    });
    const agent = await upsertVortexAgent(db, group.id, beat);
    if (beat.state === 'error') {
      log.warn(`Vortex agent ${beat.agentKey} on group #${group.id}: ${beat.lastError ?? 'error'}`);
    }
    const [latestLangpack, videoTasks] = await Promise.all([
      getLatestGroupLangpack(db, group.id),
      gameHasMedia(beat.game) ? listVideoPackTasks(db, beat.game) : Promise.resolve([]),
    ]);
    return reply.send({
      ok: true,
      groupId: group.id,
      agentId: agent.id,
      latestLangpack,
      videoTasks,
    });
  });

  app.post<{ Params: { id: string }; Body: { exportOrder?: VortexExportOrder } }>(
    '/api/vortex/groups/:id/export-order',
    async (req, reply) => {
      const id = parseRouteId(req.params.id);
      if (id === null) return reply.code(400).send({ error: 'Invalid group id' });
      if (!(await getVortexGroup(db, id)))
        return reply.code(404).send({ error: 'Group not found' });
      const order = req.body?.exportOrder;
      if (!isVortexExportOrder(order))
        return reply.code(400).send({ error: 'exportOrder is invalid' });
      await setGroupExportOrder(db, id, order);
      return reply.send({
        ok: true,
        plugins: order.plugins.length,
        fileWinners: order.fileWinners.length,
      });
    },
  );

  app.get<{ Params: { id: string } }>('/api/vortex/groups/:id/state', async (req, reply) => {
    const id = parseRouteId(req.params.id);
    if (id === null) return reply.code(400).send({ error: 'Invalid group id' });
    const group = await getVortexGroup(db, id);
    if (!group) return reply.code(404).send({ error: 'Group not found' });
    const [agent, currentRun, latestLangpack, services] = await Promise.all([
      getVortexAgentForGroup(db, id),
      findActiveVortexRun(db, id),
      getLatestGroupLangpack(db, id),
      probeKindsHealthy(STATE_SERVICE_KINDS),
    ]);
    return {
      group,
      agent,
      currentRun,
      latestLangpack,
      services,
      probedAt: new Date().toISOString(),
    };
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/vortex/groups/:id/runs',
    async (req, reply) => {
      const id = parseRouteId(req.params.id);
      if (id === null) return reply.code(400).send({ error: 'Invalid group id' });
      if (!(await getVortexGroup(db, id)))
        return reply.code(404).send({ error: 'Group not found' });
      const limit = Number(req.query.limit ?? 20);
      return { runs: await listVortexSyncRuns(db, id, Number.isFinite(limit) ? limit : 20) };
    },
  );
};

/**
 * fleet.ts (route) — what the fleet controller sees and does, plus operator overrides.
 *
 *   GET    /api/fleet                              — last controller snapshot (or offline)
 *   POST   /api/fleet/services/:name/start         — hold the service up for an hour
 *   POST   /api/fleet/services/:name/stop          — take it down and keep it down for an hour
 *   DELETE /api/fleet/services/:name/override      — back to the scheduler's decision
 *
 * The controller is a separate process (`npm run fleet`); this route only reads its
 * snapshot from Redis and writes override keys it honours on its next tick.
 */
import type { FastifyInstance } from 'fastify';
import { readFleetSnapshot, setFleetOverride } from '../../fleet/channel';
import { getSharedRedis } from '../../../worker/src/core/connection';

export const fleetRoutes = async (app: FastifyInstance) => {
  app.get('/api/fleet', async () => {
    const snapshot = await readFleetSnapshot(getSharedRedis());
    return snapshot
      ? { controller: 'online', ...snapshot }
      : { controller: 'offline', at: null, demand: {}, services: [], gpus: [], actions: [] };
  });

  app.post<{ Params: { name: string; action: string } }>(
    '/api/fleet/services/:name/:action',
    async (request, reply) => {
      const { name, action } = request.params;
      if (action !== 'start' && action !== 'stop') {
        return reply.code(400).send({ error: 'action must be start or stop' });
      }
      const snapshot = await readFleetSnapshot(getSharedRedis());
      if (snapshot && !snapshot.services.some((s) => s.name === name)) {
        return reply.code(404).send({ error: `unknown fleet service ${name}` });
      }
      await setFleetOverride(getSharedRedis(), name, action);
      return reply.send({ name, override: action });
    },
  );

  app.delete<{ Params: { name: string } }>(
    '/api/fleet/services/:name/override',
    async (request, reply) => {
      await setFleetOverride(getSharedRedis(), request.params.name, null);
      return reply.send({ name: request.params.name, override: null });
    },
  );
};

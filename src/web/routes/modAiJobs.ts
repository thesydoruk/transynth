import type { FastifyInstance } from 'fastify';
import { listActiveModAiJobs } from '../../../worker/src/api/activeModAiJobs';
import { QueueUnavailableError, withSharedRedis } from '../../../worker/src/core/connection';

export const modAiJobsRoutes = async (app: FastifyInstance) => {
  // GET /api/ai-jobs/active — queued/running mod-scoped AI jobs.
  // Polled by the UI: a Redis outage answers 503 at once instead of hanging.
  app.get('/api/ai-jobs/active', async (_req, reply) => {
    try {
      return await withSharedRedis(listActiveModAiJobs);
    } catch (err) {
      if (err instanceof QueueUnavailableError) {
        return reply.code(503).send({ error: err.message });
      }
      throw err;
    }
  });
};

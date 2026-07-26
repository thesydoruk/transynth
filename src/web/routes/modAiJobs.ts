import type { FastifyInstance } from 'fastify';
import { listActiveModAiJobs } from '../../../worker/src/api/activeModAiJobs';

export const modAiJobsRoutes = async (app: FastifyInstance) => {
  // GET /api/ai-jobs/active — queued/running mod-scoped AI jobs
  app.get('/api/ai-jobs/active', async () => listActiveModAiJobs());
};

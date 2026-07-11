import type { FastifyInstance } from 'fastify';
import { listActiveModAiJobs } from '../llm/modAiJobsStatus';

export const modAiJobsRoutes = async (app: FastifyInstance) => {
  // GET /api/ai-jobs/active — running mod-scoped AI jobs (translate, verify, skip-detect)
  app.get('/api/ai-jobs/active', async () => listActiveModAiJobs());
};

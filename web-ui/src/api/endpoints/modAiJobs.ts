import { req } from '../client';
import type { ActiveModAiJob } from '../types';

export const modAiJobsEndpoints = {
  listActive: () => req<ActiveModAiJob[]>('/api/ai-jobs/active'),
};

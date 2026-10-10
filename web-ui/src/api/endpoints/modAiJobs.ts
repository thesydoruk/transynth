import { req } from '../client';
import type { ActiveModAiJob } from '../types';

export const modAiJobsEndpoints = {
  listActive: (init?: RequestInit) => req<ActiveModAiJob[]>('/api/ai-jobs/active', init),
};

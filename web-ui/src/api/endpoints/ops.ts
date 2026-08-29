import { req } from '../client';
import type { OpsOverview } from '../types';

export const opsEndpoints = {
  overview: () => req<OpsOverview>('/api/ops'),
  reindexRag: () =>
    req<{ indexed: number; skipped: number; failed: number; total: number }>(
      '/api/ops/rag/reindex',
      { method: 'POST' },
    ),
};

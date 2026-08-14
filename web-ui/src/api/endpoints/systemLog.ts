import { req } from '../client';
import type { SystemLogResponse } from '../types/systemLog';

export const systemLogEndpoints = {
  list: (params?: { limit?: number; offset?: number; level?: string; source?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    if (params?.level) qs.set('level', params.level);
    if (params?.source) qs.set('source', params.source);
    return req<SystemLogResponse>(`/api/system-log?${qs}`);
  },
};

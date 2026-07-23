import { req } from '../client';
import type { QARule } from '../types';

export const qaRulesEndpoints = {
  list: (params?: { game?: string; ruleType?: string; isActive?: string }) => {
    const qs = new URLSearchParams();
    if (params?.game) qs.set('game', params.game);
    if (params?.ruleType) qs.set('ruleType', params.ruleType);
    if (params?.isActive) qs.set('isActive', params.isActive);
    return req<QARule[]>(`/api/qa-rules?${qs}`);
  },
  get: (id: number) => req<QARule>(`/api/qa-rules/${id}`),
  create: (data: Omit<QARule, 'id' | 'created_at' | 'updated_at'>) =>
    req<QARule>('/api/qa-rules', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Omit<QARule, 'id' | 'created_at' | 'updated_at'>>) =>
    req<QARule>(`/api/qa-rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id: number) => req<{ ok: boolean }>(`/api/qa-rules/${id}`, { method: 'DELETE' }),
};

import { getSrcLang, getTgtLang } from '../../langDefaults';
import { req } from '../client';
import type { ReferenceListResult, ReferencePromoteResult, ReferenceTranslation } from '../types';

export const referenceEndpoints = {
  list: (params: {
    game: string;
    srcLang?: string;
    tgtLang?: string;
    q?: string;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    qs.set('game', params.game);
    if (params.srcLang) qs.set('srcLang', params.srcLang);
    if (params.tgtLang) qs.set('tgtLang', params.tgtLang);
    if (params.q) qs.set('q', params.q);
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.offset != null) qs.set('offset', String(params.offset));
    return req<ReferenceListResult>(`/api/reference?${qs}`);
  },
  count: (game: string, srcLang = getSrcLang(), tgtLang = getTgtLang()) => {
    const qs = new URLSearchParams({ game, srcLang, tgtLang });
    return req<{ count: number }>(`/api/reference/count?${qs}`);
  },
  add: (body: {
    game: string;
    srcLang: string;
    tgtLang: string;
    sourceText: string;
    translation: string;
    note?: string | null;
  }) => req<ReferenceTranslation>('/api/reference', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: number, body: { sourceText?: string; translation?: string; note?: string | null }) =>
    req<ReferenceTranslation>(`/api/reference/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  remove: (id: number) => req<{ ok: boolean }>(`/api/reference/${id}`, { method: 'DELETE' }),
  removeBatch: (ids: number[]) =>
    req<{ ok: boolean; deleted: number }>('/api/reference/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  /** Copy reviewed/human translations of whole mods or single strings into the base. */
  promote: (body: { modIds?: number[]; stringIds?: number[]; targetLang?: string }) =>
    req<ReferencePromoteResult>('/api/reference/promote', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

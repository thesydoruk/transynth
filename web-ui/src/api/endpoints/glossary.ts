import { getSrcLang, getTgtLang } from '../../langDefaults';
import { req } from '../client';
import type { GlossaryEnforceResult, GlossaryEntry } from '../types';

export const glossaryEndpoints = {
  list: (params?: { srcLang?: string; tgtLang?: string; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.srcLang) qs.set('srcLang', params.srcLang);
    if (params?.tgtLang) qs.set('tgtLang', params.tgtLang);
    if (params?.q) qs.set('q', params.q);
    return req<GlossaryEntry[]>(`/api/glossary?${qs}`);
  },
  add: (term: string, translation: string | null, srcLang = getSrcLang(), tgtLang = getTgtLang()) =>
    req<GlossaryEntry>('/api/glossary', {
      method: 'POST',
      body: JSON.stringify({ term, translation, srcLang, tgtLang }),
    }),
  update: (id: number, term: string, translation: string | null) =>
    req<GlossaryEntry>(`/api/glossary/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ term, translation }),
    }),
  remove: (id: number) => req<{ ok: boolean }>(`/api/glossary/${id}`, { method: 'DELETE' }),

  /** Batch-enforce glossary terms as QA rules across translated strings. */
  enforce: (opts?: { modId?: number; targetLang?: string }) =>
    req<GlossaryEnforceResult>('/api/glossary/enforce', {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    }),
};

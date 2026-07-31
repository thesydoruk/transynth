import { getTgtLang } from '../../langDefaults';
import { req } from '../client';
import type { CoherenceResult } from '../types';

export const coherenceEndpoints = {
  /**
   * Returns a paginated coherence report.
   * Groups are ordered by variant_count DESC (most conflicted first).
   */
  list: (params?: { targetLang?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.targetLang) qs.set('targetLang', params.targetLang);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    return req<CoherenceResult>(`/api/coherence?${qs}`);
  },
  /**
   * Resolves a coherence group by propagating a single chosen translation
   * to all strings with the same exact source text that currently differ.
   */
  resolve: (sourceText: string, translation: string, targetLang = getTgtLang()) =>
    req<{ updated: number }>('/api/coherence/resolve', {
      method: 'POST',
      body: JSON.stringify({ sourceText, translation, targetLang }),
    }),
  /**
   * Auto-resolves all inconsistency groups for the target language in one pass.
   * The most-used translation wins per group; ties are broken by status quality.
   */
  resolveAll: (targetLang = getTgtLang()) =>
    req<{ resolved: number; updated: number }>('/api/coherence/resolve-all', {
      method: 'POST',
      body: JSON.stringify({ targetLang }),
    }),
};

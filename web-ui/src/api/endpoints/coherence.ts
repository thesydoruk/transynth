import { getTgtLang } from '../../langDefaults';
import { req } from '../client';
import type { CoherenceResult } from '../types';

export const coherenceEndpoints = {
  /**
   * Returns a paginated coherence report.
   * Groups are ordered by variant_count DESC (most conflicted first).
   */
  list: (params?: { targetLang?: string; limit?: number; offset?: number; game?: string }) => {
    const qs = new URLSearchParams();
    if (params?.targetLang) qs.set('targetLang', params.targetLang);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    if (params?.game) qs.set('game', params.game);
    return req<CoherenceResult>(`/api/coherence?${qs}`);
  },
  /**
   * Resolves a coherence group by propagating a single chosen translation
   * to all strings with the same exact source text and record signature.
   */
  resolve: (
    sourceText: string,
    signature: string,
    translation: string,
    targetLang = getTgtLang(),
    game?: string,
  ) =>
    req<{ updated: number }>('/api/coherence/resolve', {
      method: 'POST',
      body: JSON.stringify({ sourceText, signature, translation, targetLang, game }),
    }),
  /**
   * Auto-resolves all inconsistency groups for the target language in one pass.
   * The most-used translation wins per group; ties are broken by status quality.
   */
  resolveAll: (targetLang = getTgtLang(), game?: string) =>
    req<{ resolved: number; updated: number }>('/api/coherence/resolve-all', {
      method: 'POST',
      body: JSON.stringify({ targetLang, game }),
    }),
};

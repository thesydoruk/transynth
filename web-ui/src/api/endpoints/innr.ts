import { req } from '../client';
import type { InnrResult } from '../types';

export const innrEndpoints = {
  /**
   * Returns all INNR strings for a mod, grouped by base EDID prefix.
   * Translators see all naming rule slots together for grammatical agreement.
   */
  list: (modId: number, params?: { targetLang?: string; srcLang?: string }) => {
    const qs = new URLSearchParams();
    if (params?.targetLang) qs.set('targetLang', params.targetLang);
    if (params?.srcLang) qs.set('srcLang', params.srcLang);
    return req<InnrResult>(`/api/mods/${modId}/innr?${qs}`);
  },
};

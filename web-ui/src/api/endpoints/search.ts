import { req } from '../client';
import type { SearchReplaceMatch } from '../types';

export const searchEndpoints = {
  replace: (
    modId: number,
    body: {
      search: string;
      replace: string;
      isRegex?: boolean;
      targetLang?: string;
      dryRun?: boolean;
    },
  ) =>
    req<{ matches: SearchReplaceMatch[]; applied: number }>(`/api/mods/${modId}/search-replace`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

import { req } from '../client';
import type { VortexGameRelease, VortexGroup } from '../types/vortex';

export const vortexEndpoints = {
  groups: (game?: string) => {
    const params = game ? `?game=${encodeURIComponent(game)}` : '';
    return req<{ groups: VortexGroup[] }>(`/api/vortex/groups${params}`);
  },
  group: (id: number) =>
    req<{ group: VortexGroup; releases: VortexGameRelease[] }>(`/api/vortex/groups/${id}`),
};

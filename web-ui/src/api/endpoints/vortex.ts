import { req } from '../client';
import type {
  VortexGameRelease,
  VortexGroup,
  VortexGroupState,
  VortexRun,
  VortexRunStatus,
  VortexStage,
} from '../types/vortex';

export const vortexEndpoints = {
  groups: (game?: string) => {
    const params = game ? `?game=${encodeURIComponent(game)}` : '';
    return req<{ groups: VortexGroup[] }>(`/api/vortex/groups${params}`);
  },
  group: (id: number) =>
    req<{ group: VortexGroup; releases: VortexGameRelease[] }>(`/api/vortex/groups/${id}`),
  state: (id: number) => req<VortexGroupState>(`/api/vortex/groups/${id}/state`),
  runs: (id: number, limit = 20) =>
    req<{ runs: VortexRun[] }>(`/api/vortex/groups/${id}/runs?limit=${limit}`),
  run: (runId: number) => req<VortexRunStatus>(`/api/vortex/sync/${runId}`),
  startStage: (id: number, stage: VortexStage, options: Record<string, unknown> = {}) =>
    req<{ ok: true; runId: number; jobId: number; stage: VortexStage }>(
      `/api/vortex/groups/${id}/stage/${stage}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ options, startedBy: 'ui' }),
      },
    ),
  stopRun: (runId: number) =>
    req<{ ok: true; stopped: number[] }>(`/api/vortex/sync/${runId}/stop`, { method: 'POST' }),
  langpackPath: (runId: number) => `/api/vortex/sync/${runId}/langpack`,
};

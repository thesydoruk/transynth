import { apiUrl, req } from '../client';
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
  /** `agentId` names the machine the stage is for; without it the stage covers the group. */
  startStage: (
    id: number,
    stage: VortexStage,
    options: Record<string, unknown> = {},
    agentId?: number | null,
  ) =>
    req<{ ok: true; runId: number; jobId: number; stage: VortexStage }>(
      `/api/vortex/groups/${id}/stage/${stage}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ options, startedBy: 'ui', ...(agentId != null ? { agentId } : {}) }),
      },
    ),
  forgetMachine: (id: number, machineId: number) =>
    req<{ ok: true }>(`/api/vortex/groups/${id}/machines/${machineId}`, { method: 'DELETE' }),
  stopRun: (runId: number) =>
    req<{ ok: true; stopped: number[] }>(`/api/vortex/sync/${runId}/stop`, { method: 'POST' }),
  /** The run's finished langpack, for a download link. */
  langpackUrl: (runId: number) => apiUrl(`/api/vortex/sync/${runId}/langpack`),
};

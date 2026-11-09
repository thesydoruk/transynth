import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type VortexStage } from '../../api';

/** Service kinds a stage needs, mirrored from the server's STAGE_NEEDS. */
export const STAGE_NEEDS: Record<VortexStage, Array<'llm' | 'embed' | 'tts'>> = {
  tm: [],
  llm: ['llm', 'embed'],
  verify: ['llm', 'embed'],
  skip: ['llm'],
  gender: ['llm'],
  voice: ['tts'],
  export: [],
};

export const STAGE_BUTTONS: VortexStage[] = [
  'tm',
  'llm',
  'verify',
  'skip',
  'gender',
  'voice',
  'export',
];

const ACTIVE_STATES = new Set(['queued', 'running', 'planning']);

/** The agent is offline when three polls went by without a heartbeat. */
export const agentIsOffline = (lastSeenAt: string, pollSec: number | undefined, now = Date.now()) =>
  now - Date.parse(lastSeenAt) > 3 * Math.max(10, pollSec ?? 30) * 1000;

export const useVortexPage = (gameId: string) => {
  const qc = useQueryClient();
  const [groupId, setGroupId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useQuery({
    queryKey: ['vortex-groups', gameId],
    queryFn: () => api.vortex.groups(gameId),
    enabled: !!gameId,
  });
  const groupList = groups.data?.groups ?? [];
  useEffect(() => {
    if (groupId == null && groupList.length > 0) setGroupId(groupList[0]!.id);
  }, [groupId, groupList]);

  const state = useQuery({
    queryKey: ['vortex-state', groupId],
    queryFn: () => api.vortex.state(groupId!),
    enabled: groupId != null,
    refetchInterval: (query) => {
      const data = query.state.data;
      const busy = data?.currentRun != null || (data?.agent != null && data.agent.state !== 'idle');
      return busy ? 5000 : 15000;
    },
  });
  const currentRunId = state.data?.currentRun?.id ?? null;

  const run = useQuery({
    queryKey: ['vortex-run', currentRunId],
    queryFn: () => api.vortex.run(currentRunId!),
    enabled: currentRunId != null,
    refetchInterval: 3000,
  });

  const runs = useQuery({
    queryKey: ['vortex-runs', groupId],
    queryFn: () => api.vortex.runs(groupId!),
    enabled: groupId != null,
    refetchInterval: 15000,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['vortex-state', groupId] });
    void qc.invalidateQueries({ queryKey: ['vortex-runs', groupId] });
  };

  const start = useMutation({
    mutationFn: ({ stage, options }: { stage: VortexStage; options?: Record<string, unknown> }) =>
      api.vortex.startStage(groupId!, stage, options),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const stop = useMutation({
    mutationFn: (runId: number) => api.vortex.stopRun(runId),
    onSuccess: invalidate,
    onError: (err: Error) => setError(err.message),
  });

  const services = state.data?.services ?? {};
  const runActive = currentRunId != null && ACTIVE_STATES.has(state.data?.currentRun?.status ?? '');
  const canStart = (stage: VortexStage): { ok: boolean; missing: string | null } => {
    if (runActive || start.isPending) return { ok: false, missing: null };
    const missing = STAGE_NEEDS[stage].find((kind) => services[kind] === false);
    return { ok: !missing, missing: missing ?? null };
  };

  return {
    groups: groupList,
    groupId,
    setGroupId,
    state: state.data ?? null,
    isLoading: groups.isLoading || (groupId != null && state.isLoading),
    run: run.data ?? null,
    runActive,
    history: runs.data?.runs ?? [],
    start: (stage: VortexStage, options?: Record<string, unknown>) =>
      start.mutate({ stage, options }),
    starting: start.isPending,
    stop: (runId: number) => stop.mutate(runId),
    canStart,
    error,
    clearError: () => setError(null),
  };
};

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type ModImportJob } from '../../../api';
import { modListQueryKey } from '../../../langDefaults';
import { isActiveModImportJob } from '../modsPageUtils';
import type { UnifiedJob } from '../modsPageTypes';

export const useModsPageData = (gameId: string, srcLang: string, targetLang: string) => {
  const {
    data: mods,
    isLoading: isModsLoading,
    error: modsError,
  } = useQuery({
    queryKey: modListQueryKey(gameId, srcLang, targetLang),
    queryFn: () => api.mods.list(gameId, srcLang, targetLang),
  });

  const { data: eetJobs } = useQuery({
    queryKey: ['eet-imports'],
    queryFn: api.eet.list,
    refetchInterval: 3000,
  });
  const { data: csvJobs } = useQuery({
    queryKey: ['csv-imports'],
    queryFn: api.csv.list,
    refetchInterval: 3000,
  });
  const { data: modJobs } = useQuery({
    queryKey: ['mod-imports'],
    queryFn: api.modImport.list,
    refetchInterval: 3000,
  });
  const { data: opsData } = useQuery({
    queryKey: ['ops'],
    queryFn: api.ops.overview,
    refetchInterval: 5000,
  });

  const gameModJobs = useMemo(
    () => (modJobs ?? []).filter((job) => job.game === gameId),
    [modJobs, gameId],
  );

  const importJobByModId = useMemo(() => {
    const map = new Map<number, ModImportJob>();
    for (const job of gameModJobs) {
      if (job.mod_id == null || job.status !== 'completed') continue;
      const existing = map.get(job.mod_id);
      if (!existing || new Date(job.updated_at) > new Date(existing.updated_at)) {
        map.set(job.mod_id, job);
      }
    }
    return map;
  }, [gameModJobs]);

  const importedModIds = useMemo(() => new Set((mods ?? []).map((mod) => mod.id)), [mods]);

  const activeImportJobs: UnifiedJob[] = useMemo(
    () =>
      [
        ...(eetJobs ?? []).map((job): UnifiedJob => ({ kind: 'eet', job })),
        ...(csvJobs ?? []).map((job): UnifiedJob => ({ kind: 'csv', job })),
        ...gameModJobs
          .filter((job) => isActiveModImportJob(job, importedModIds))
          .map((job): UnifiedJob => ({ kind: 'mod', job })),
      ].sort((a, b) => new Date(b.job.created_at).getTime() - new Date(a.job.created_at).getTime()),
    [eetJobs, csvJobs, gameModJobs, importedModIds],
  );

  const sortedMods = useMemo(
    () => [...(mods ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [mods],
  );

  return {
    mods,
    isModsLoading,
    modsError,
    eetJobs,
    csvJobs,
    modJobs,
    opsData,
    gameModJobs,
    importJobByModId,
    importedModIds,
    activeImportJobs,
    sortedMods,
  };
};

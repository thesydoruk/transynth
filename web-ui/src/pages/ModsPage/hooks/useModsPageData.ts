import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type ModImportJob } from '../../../api';
import { modListQueryKey } from '../../../langDefaults';
import { isActiveModImportJob } from '../modsPageUtils';

/** Every mod of the game, whatever its source: manual uploads and all Vortex groups. */
export const useModsPageData = (gameId: string, srcLang: string, targetLang: string) => {
  const {
    data: mods,
    isLoading: isModsLoading,
    error: modsError,
  } = useQuery({
    queryKey: [...modListQueryKey(gameId, srcLang, targetLang), 'all'],
    queryFn: () => api.mods.list(gameId, srcLang, targetLang, 'all'),
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

  const activeImportJobs = useMemo(
    () =>
      gameModJobs
        .filter((job) => isActiveModImportJob(job, importedModIds))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [gameModJobs, importedModIds],
  );

  return {
    mods,
    isModsLoading,
    modsError,
    modJobs,
    opsData,
    gameModJobs,
    importJobByModId,
    importedModIds,
    activeImportJobs,
  };
};

import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

/** Whether the server has a Nexus Mods personal API key configured. */
export const useNexusApiConfigured = () => {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
    staleTime: 60_000,
  });

  const isKnown = !isLoading && !isError && data !== undefined;

  return {
    isLoading,
    isKnown,
    isConfigured: Boolean(data?.nexusApiKeyConfigured),
  };
};

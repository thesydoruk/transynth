import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type GameInfo } from '../../../api';
import { useNexusApiConfigured } from '../../../hooks/useNexusApiConfigured';

export const useGameModDetailsQueries = (gameId: string, numericModId: number) => {
  const {
    isLoading: isNexusConfigLoading,
    isKnown: nexusConfigKnown,
    isConfigured: nexusConfigured,
  } = useNexusApiConfigured();

  const {
    data: games,
    isLoading: isGamesLoading,
    error: gamesError,
  } = useQuery({
    queryKey: ['games'],
    queryFn: api.games.list,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const game: GameInfo | undefined = useMemo(
    () => games?.find((g) => g.id === gameId),
    [games, gameId],
  );

  const nexusQueriesEnabled =
    !!game &&
    Number.isFinite(numericModId) &&
    numericModId > 0 &&
    nexusConfigKnown &&
    nexusConfigured;

  const {
    data: details,
    isLoading: isDetailsLoading,
    error: detailsError,
  } = useQuery({
    queryKey: ['nexus-mod-details', gameId, numericModId],
    queryFn: () => api.games.modDetails(gameId, numericModId),
    enabled: nexusQueriesEnabled,
  });

  const {
    data: translations,
    isLoading: isTranslationsLoading,
    error: translationsError,
  } = useQuery({
    queryKey: ['nexus-translations', gameId, numericModId],
    queryFn: () => api.games.findTranslations(gameId, numericModId, undefined, 50),
    enabled: nexusQueriesEnabled,
  });

  const {
    data: relations,
    isLoading: isRelationsLoading,
    error: relationsError,
  } = useQuery({
    queryKey: ['nexus-mod-relations', gameId, numericModId],
    queryFn: () => api.games.modRelations(gameId, numericModId, 100),
    enabled: nexusQueriesEnabled,
  });

  return {
    game,
    isGamesLoading,
    gamesError,
    isNexusConfigLoading,
    nexusConfigKnown,
    nexusConfigured,
    details,
    isDetailsLoading,
    detailsError,
    translations,
    isTranslationsLoading,
    translationsError,
    relations,
    isRelationsLoading,
    relationsError,
  };
};

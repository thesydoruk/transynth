import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api';

/** The game's catalogue entry; `game` is undefined while loading or for an unknown id. */
export const useGameInfo = (gameId: string) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['games'],
    queryFn: api.games.list,
    staleTime: 60_000,
  });
  return { game: data?.find((g) => g.id === gameId), isLoading, error };
};

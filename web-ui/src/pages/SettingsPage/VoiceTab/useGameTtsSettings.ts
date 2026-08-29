import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api';
import {
  patchGameTtsMap,
  type GameTtsMatchSettings,
  type GameTtsSettingsMap,
} from './voiceSettingsConfig';

const readGameTtsMap = (data: Record<string, unknown> | undefined): GameTtsSettingsMap => {
  const raw = data?.['voice.game_tts'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as GameTtsSettingsMap;
};

/** Load/save per-game xtts-engine match flags (`voice.game_tts`). */
export const useGameTtsSettings = () => {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['projectSettings'],
    queryFn: api.projectSettings.getAll,
    staleTime: 30_000,
  });

  const { mutate, isPending } = useMutation({
    mutationFn: (value: GameTtsSettingsMap) => api.projectSettings.update('voice.game_tts', value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projectSettings'] });
    },
  });

  const map = readGameTtsMap(data);

  const patchGame = (gameId: string, patch: Partial<GameTtsMatchSettings>) => {
    mutate(patchGameTtsMap(map, gameId, patch));
  };

  return { map, patchGame, isLoading, error, isPending };
};

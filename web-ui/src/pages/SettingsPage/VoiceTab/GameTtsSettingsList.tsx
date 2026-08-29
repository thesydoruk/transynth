import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api';
import { GameTtsMatchToggles } from './GameTtsMatchToggles';
import { useGameTtsSettings } from './useGameTtsSettings';
import { gameTtsMatchFor } from './voiceSettingsConfig';
import s from './VoiceTab.module.scss';

/** Per-game xtts-engine match flags listed in Settings → Voice. */
export const GameTtsSettingsList = () => {
  const { t } = useTranslation();
  const { map, patchGame, isPending } = useGameTtsSettings();

  const {
    data: games,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['games'],
    queryFn: api.games.list,
    staleTime: 60_000,
  });

  if (isLoading) return <div className={s.center}>{t('common.loading')}</div>;
  if (error) {
    return (
      <div className={`${s.center} ${s.error}`}>
        {t('common.error', { message: String(error) })}
      </div>
    );
  }

  return (
    <div className={s.gameList}>
      {(games ?? []).map((game) => (
        <div key={game.id} className={s.gameBlock}>
          <div className={s.gameHeading}>
            <span className={s.gameName}>{game.name}</span>
            <code className={s.gameCode}>{game.id}</code>
          </div>
          <GameTtsMatchToggles
            value={gameTtsMatchFor(map, game.id)}
            disabled={isPending}
            onChange={(patch) => patchGame(game.id, patch)}
          />
        </div>
      ))}
    </div>
  );
};

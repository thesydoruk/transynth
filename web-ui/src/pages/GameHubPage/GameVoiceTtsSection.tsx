import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GameTtsMatchToggles } from '../SettingsPage/VoiceTab/GameTtsMatchToggles';
import { useGameTtsSettings } from '../SettingsPage/VoiceTab/useGameTtsSettings';
import { gameTtsMatchFor } from '../SettingsPage/VoiceTab/voiceSettingsConfig';
import s from './GameHubPage.module.scss';

type GameVoiceTtsSectionProps = {
  gameId: string;
  gameName: string;
};

/** xtts-engine match flags for the game currently open in Game Hub. */
export const GameVoiceTtsSection = ({ gameId, gameName }: GameVoiceTtsSectionProps) => {
  const { t } = useTranslation();
  const { map, patchGame, isLoading, error, isPending } = useGameTtsSettings();

  return (
    <section className={s.voicePanel} aria-label={t('gameHub.voicePanelTitle')}>
      <div className={s.voicePanelHeader}>
        <span className={s.releasePanelKicker}>{t('gameHub.voiceKicker')}</span>
        <h2 className={s.releasePanelTitle}>{t('gameHub.voicePanelTitle')}</h2>
        <p className={s.releasePanelDesc}>{t('gameHub.voicePanelDesc', { game: gameName })}</p>
      </div>
      {isLoading ? (
        <p className={s.voicePanelStatus}>{t('common.loading')}</p>
      ) : error ? (
        <p className={s.voicePanelError}>{t('common.error', { message: String(error) })}</p>
      ) : (
        <GameTtsMatchToggles
          value={gameTtsMatchFor(map, gameId)}
          disabled={isPending}
          onChange={(patch) => patchGame(gameId, patch)}
        />
      )}
      <Link to="/settings?tab=voice" className={s.viewAll}>
        {t('gameHub.voiceSettingsLink')}
      </Link>
    </section>
  );
};

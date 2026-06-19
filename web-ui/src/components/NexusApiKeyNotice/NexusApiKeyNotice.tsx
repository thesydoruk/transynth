import { useTranslation } from 'react-i18next';
import s from './NexusApiKeyNotice.module.scss';

const NEXUS_API_KEYS_URL = 'https://www.nexusmods.com/users/myaccount?tab=api';

/** Banner shown when Nexus Mods integration is unavailable due to a missing server key. */
export const NexusApiKeyNotice = () => {
  const { t } = useTranslation();

  return (
    <div className={s.notice} role="status">
      <h2 className={s.title}>{t('games.nexusApiKey.title')}</h2>
      <p className={s.body}>{t('games.nexusApiKey.body')}</p>
      <p className={s.envHint}>{t('games.nexusApiKey.envHint')}</p>
      <a className={s.link} href={NEXUS_API_KEYS_URL} target="_blank" rel="noopener noreferrer">
        {t('games.nexusApiKey.linkText')}
      </a>
    </div>
  );
};

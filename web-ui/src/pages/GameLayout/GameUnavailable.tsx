import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { routes } from '../../routes';
import s from './GameLayout.module.scss';

type GameUnavailableProps = {
  /** `loading` and `error` replace the whole page; `missing` is an unknown game id. */
  state: 'loading' | 'error' | 'missing';
  error?: unknown;
};

export const GameUnavailable = ({ state, error }: GameUnavailableProps) => {
  const { t } = useTranslation();

  if (state === 'loading') return <div className={s.notice}>{t('common.loading')}</div>;
  if (state === 'error') {
    return (
      <div className={`${s.notice} ${s.noticeError}`}>
        {t('common.error', { message: String(error) })}
      </div>
    );
  }
  return (
    <div className={s.missing}>
      <Link to={routes.games()} className={s.backLink}>
        {t('games.backToGames')}
      </Link>
      <h1 className={s.missingTitle}>{t('games.notFoundTitle')}</h1>
      <p className={s.missingText}>{t('games.notFoundSubtitle')}</p>
    </div>
  );
};

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import s from './GameHeader.module.scss';

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
    <div className={s.page}>
      <Link to="/" className={s.backLink}>
        {t('games.backToGames')}
      </Link>
      <h1 className={s.name}>{t('games.notFoundTitle')}</h1>
      <p className={s.meta}>{t('games.notFoundSubtitle')}</p>
    </div>
  );
};

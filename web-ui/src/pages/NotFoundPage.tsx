import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import s from './NotFoundPage.module.scss';

/** Unknown route — no compatibility aliases. */
export const NotFoundPage = () => {
  const { t } = useTranslation();
  return (
    <div className={s.page}>
      <h1 className={s.title}>{t('notFound.title')}</h1>
      <p className={s.body}>{t('notFound.body')}</p>
      <Link className={s.link} to="/">
        {t('notFound.games')}
      </Link>
    </div>
  );
};

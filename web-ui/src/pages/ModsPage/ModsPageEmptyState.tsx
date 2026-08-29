import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import s from './ModsPage.module.scss';

type ModsPageEmptyStateProps = {
  gameId: string;
  onUploadClick: () => void;
};

export const ModsPageEmptyState = ({ gameId, onUploadClick }: ModsPageEmptyStateProps) => {
  const { t } = useTranslation();

  return (
    <div className={s.emptyState}>
      <h2 className={s.emptyTitle}>{t('mods.noModsFound')}</h2>
      <p className={s.emptyText}>{t('mods.noModsHint')}</p>
      <div className={s.emptyActions}>
        <button onClick={onUploadClick} className={s.btn}>
          {t('imports.emptyUploadAction')}
        </button>
        <Link to={`/games/${gameId}/nexus`} className={s.emptyLinkBtn}>
          {t('imports.emptyDiscoverAction')}
        </Link>
      </div>
    </div>
  );
};
